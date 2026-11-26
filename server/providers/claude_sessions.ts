import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getSessionInfo, getSessionMessages, listSessions } from '@anthropic-ai/claude-agent-sdk';
import type { OpenInfo, TranscriptEntry } from '@shared/types';
import { describeToolInput } from './claude_code';
import { describeToolChange, extractToolResults, type ToolResult } from './tool_output';

/** A chat is "active" when its transcript was written to this recently. */
export const ACTIVE_WINDOW_MS = 3 * 60 * 1000;

export interface ExternalSessionInfo {
	sessionId: string;
	title: string;
	cwd?: string;
	branch?: string;
	createdAt?: number;
	lastModified: number;
	fileSize?: number;
}

export interface ExternalMessage {
	type: 'user' | 'assistant' | 'system';
	uuid: string;
	message: unknown;
	parent_tool_use_id: string | null;
	/** When the message was written, where the saved chat records it. */
	timestamp?: number;
}

export interface OpenSession extends OpenInfo {
	sessionId: string;
	cwd?: string;
}

/** Read access to chats stored by Claude Code on this machine. Injected so tests never touch ~/.claude. */
export interface ExternalSource {
	list(limit: number): Promise<ExternalSessionInfo[]>;
	info(sessionId: string): Promise<ExternalSessionInfo | undefined>;
	messages(sessionId: string, offset?: number): Promise<ExternalMessage[]>;
	/** Chats a running Claude Code process has open right now. */
	open(): Promise<OpenSession[]>;
}

const CLIENT_LABELS: Record<string, string> = { 'claude-vscode': 'VS Code', cli: 'terminal' };

export function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/**
 * Claude Code writes ~/.claude/sessions/<pid>.json for each running process.
 * Entries whose process is gone are stale and ignored.
 */
export async function readOpenSessions(
	dir = path.join(os.homedir(), '.claude', 'sessions'),
	alive: (pid: number) => boolean = isProcessAlive
): Promise<OpenSession[]> {
	let names: string[];
	try {
		names = await fs.readdir(dir);
	} catch {
		return [];
	}
	const open: OpenSession[] = [];
	for (const name of names) {
		if (!/^\d+\.json$/.test(name)) continue;
		try {
			const parsed = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')) as {
				pid?: number;
				sessionId?: string;
				cwd?: string;
				status?: string;
				statusUpdatedAt?: number;
				entrypoint?: string;
				name?: string;
			};
			if (!parsed.pid || !parsed.sessionId || !alive(parsed.pid)) continue;
			open.push({
				pid: parsed.pid,
				sessionId: parsed.sessionId,
				cwd: parsed.cwd,
				status: parsed.status ?? 'unknown',
				statusSince:
					typeof parsed.statusUpdatedAt === 'number' ? parsed.statusUpdatedAt : undefined,
				client: parsed.entrypoint
					? (CLIENT_LABELS[parsed.entrypoint] ?? parsed.entrypoint)
					: undefined,
				name: parsed.name,
			});
		} catch {
			// A half-written or foreign file: skip it.
		}
	}
	return open;
}

const toInfo = (s: {
	sessionId: string;
	summary: string;
	customTitle?: string;
	firstPrompt?: string;
	cwd?: string;
	gitBranch?: string;
	createdAt?: number;
	lastModified: number;
	fileSize?: number;
}): ExternalSessionInfo => ({
	sessionId: s.sessionId,
	title: (s.customTitle || s.summary || s.firstPrompt || s.sessionId).trim().slice(0, 120),
	cwd: s.cwd,
	branch: s.gitBranch,
	createdAt: s.createdAt,
	lastModified: s.lastModified,
	fileSize: s.fileSize,
});

/**
 * When each message of a saved chat was written. Claude Code keeps a chat as one JSON record per
 * line and only ever adds to it, so each call reads just what was appended since the last one.
 */
export class MessageTimes {
	private readonly chats = new Map<
		string,
		{ file: string; read: number; times: Map<string, number> }
	>();

	constructor(
		private readonly projectsDir = path.join(
			process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'),
			'projects'
		)
	) {}

	private async find(sessionId: string): Promise<string | undefined> {
		if (!/^[\w-]+$/.test(sessionId)) return undefined;
		const folders = await fs.readdir(this.projectsDir).catch(() => []);
		for (const folder of folders) {
			const file = path.join(this.projectsDir, folder, `${sessionId}.jsonl`);
			if (
				await fs.stat(file).then(
					(s) => s.isFile(),
					() => false
				)
			)
				return file;
		}
		return undefined;
	}

	async of(sessionId: string): Promise<Map<string, number>> {
		let chat = this.chats.get(sessionId);
		if (!chat) {
			const file = await this.find(sessionId);
			if (!file) return new Map();
			chat = { file, read: 0, times: new Map() };
			this.chats.set(sessionId, chat);
		}
		try {
			const { size } = await fs.stat(chat.file);
			if (size < chat.read) {
				chat.read = 0;
				chat.times.clear();
			}
			if (size > chat.read) {
				const handle = await fs.open(chat.file, 'r');
				try {
					const buffer = Buffer.alloc(size - chat.read);
					await handle.read(buffer, 0, buffer.length, chat.read);
					// A record still being written has no line end yet; leave it for next time.
					const end = buffer.lastIndexOf(0x0a);
					if (end >= 0) {
						for (const line of buffer.subarray(0, end).toString('utf8').split('\n')) {
							if (!line) continue;
							try {
								const record = JSON.parse(line) as { uuid?: unknown; timestamp?: unknown };
								const at =
									typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : NaN;
								if (typeof record.uuid === 'string' && Number.isFinite(at))
									chat.times.set(record.uuid, at);
							} catch {
								// Not a record this reader understands; its message keeps a fallback time.
							}
						}
						chat.read += end + 1;
					}
				} finally {
					await handle.close();
				}
			}
		} catch {
			// The chat file went away or cannot be read: times fall back, messages still show.
		}
		return chat.times;
	}
}

export class SdkExternalSource implements ExternalSource {
	async list(limit: number): Promise<ExternalSessionInfo[]> {
		return (await listSessions({ limit })).map(toInfo);
	}

	async info(sessionId: string): Promise<ExternalSessionInfo | undefined> {
		const found = await getSessionInfo(sessionId);
		return found ? toInfo(found) : undefined;
	}

	private readonly times = new MessageTimes();

	async messages(sessionId: string, offset = 0): Promise<ExternalMessage[]> {
		const messages = (await getSessionMessages(sessionId, { offset })) as ExternalMessage[];
		if (!messages.length) return messages;
		// The SDK hands back messages without their times; the saved chat has them.
		const times = await this.times.of(sessionId);
		return messages.map((message) => ({ ...message, timestamp: times.get(message.uuid) }));
	}

	open(): Promise<OpenSession[]> {
		return readOpenSessions();
	}
}

export class NoExternalSource implements ExternalSource {
	async list(): Promise<ExternalSessionInfo[]> {
		return [];
	}
	async info(): Promise<undefined> {
		return undefined;
	}
	async messages(): Promise<ExternalMessage[]> {
		return [];
	}
	async open(): Promise<OpenSession[]> {
		return [];
	}
}

export function toOpenInfo(open: OpenSession | undefined): OpenInfo | undefined {
	if (!open) return undefined;
	const { pid, status, statusSince, client, name } = open;
	return { pid, status, statusSince, client, name };
}

interface ContentBlock {
	type: string;
	id?: string;
	text?: string;
	name?: string;
	input?: unknown;
}

interface AnthropicMessage {
	role?: string;
	model?: string;
	content?: string | ContentBlock[];
}

export interface ConvertedTranscript {
	entries: TranscriptEntry[];
	/** Model named by the most recent assistant message. */
	lastModel?: string;
	/** Number of user prompts, so the card's turn count matches. */
	prompts: number;
	/** Tool results whose call was not in this batch (it arrived in an earlier sync). */
	orphanResults: ToolResult[];
}

const stripReminders = (text: string) =>
	text
		.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
		.replace(/<ide_selection>[\s\S]*?<\/ide_selection>/g, '')
		.trim();

/** Maps raw Claude Code messages onto transcript entries: prompts, replies and tool calls, nothing else. */
export function convertMessages(
	messages: ExternalMessage[],
	baseTs = Date.now()
): ConvertedTranscript {
	const entries: TranscriptEntry[] = [];
	const results: ToolResult[] = [];
	let lastModel: string | undefined;
	let prompts = 0;
	let lastTs = 0;
	messages.forEach((raw, index) => {
		if (raw.parent_tool_use_id) return;
		const message = (raw.message ?? {}) as AnthropicMessage;
		// The message's own time where it is known; never earlier than the one before it.
		const ts = Math.max(raw.timestamp ?? baseTs + index, lastTs);
		lastTs = ts;
		const id = `${raw.uuid}-${index}`;
		if (raw.type === 'user') {
			results.push(...extractToolResults(message.content));
			let text = '';
			if (typeof message.content === 'string') text = message.content;
			else if (Array.isArray(message.content)) {
				const texts = message.content
					.filter((b) => b.type === 'text' && b.text)
					.map((b) => b.text as string);
				const attachments = message.content.filter(
					(b) => b.type === 'document' || b.type === 'image'
				).length;
				text = texts.join('\n');
				if (!text && attachments && !message.content.some((b) => b.type === 'tool_result'))
					text = '[attached file]';
			}
			text = stripReminders(text);
			if (!text) return;
			prompts += 1;
			entries.push({ id, ts, kind: 'user', text });
		} else if (raw.type === 'assistant') {
			if (message.model) lastModel = message.model;
			if (!Array.isArray(message.content)) return;
			message.content.forEach((block, blockIndex) => {
				if (block.type === 'text' && block.text?.trim()) {
					entries.push({ id: `${id}-${blockIndex}`, ts, kind: 'assistant', text: block.text });
				} else if (block.type === 'tool_use' && block.name) {
					entries.push({
						id: `${id}-${blockIndex}`,
						ts,
						kind: 'tool',
						name: block.name,
						summary: describeToolInput(block.name, (block.input ?? {}) as Record<string, unknown>),
						toolUseId: block.id,
						diff: describeToolChange(block.name, (block.input ?? {}) as Record<string, unknown>),
					});
				}
			});
		}
	});
	const orphanResults = applyToolResults(entries, results);
	return { entries, lastModel, prompts, orphanResults };
}

/** Attaches tool results to the matching tool entries, newest first; returns the ones with no match. */
export function applyToolResults(entries: TranscriptEntry[], results: ToolResult[]): ToolResult[] {
	const orphans: ToolResult[] = [];
	for (const result of results) {
		let matched = false;
		for (let i = entries.length - 1; i >= 0; i -= 1) {
			const entry = entries[i];
			if (entry?.kind === 'tool' && entry.toolUseId === result.toolUseId) {
				entry.output = result.output;
				entry.isError = result.isError;
				matched = true;
				break;
			}
		}
		if (!matched) orphans.push(result);
	}
	return orphans;
}

export const MAX_IMPORTED_ENTRIES = 1500;

/** Keeps a long chat's tail so the card stays responsive; the full history is still in Claude Code. */
export function trimEntries(
	entries: TranscriptEntry[],
	max = MAX_IMPORTED_ENTRIES
): TranscriptEntry[] {
	if (entries.length <= max) return entries;
	const hidden = entries.length - max;
	const first = entries[entries.length - max]!;
	return [
		{
			id: `trimmed-${first.id}`,
			ts: first.ts,
			kind: 'system',
			text: `${hidden} earlier entries are not shown here.`,
		},
		...entries.slice(-max),
	];
}
