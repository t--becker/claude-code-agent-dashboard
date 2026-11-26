import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ArtifactItem, ArtifactKind } from '@shared/types';

/**
 * The artifact library is read out of Claude Code's own saved chats: every page an agent
 * published with the Artifact tool, and every deliverable file (a prototype page, a PDF, a
 * spreadsheet, a document, a deck) an agent wrote or pointed you to. Nothing is fetched from
 * claude.ai; a page deleted there by hand still shows here until its chat is gone.
 */

const KIND_BY_EXTENSION: Record<string, ArtifactKind> = {
	'.html': 'page',
	'.htm': 'page',
	'.pdf': 'pdf',
	'.xlsx': 'sheet',
	'.xls': 'sheet',
	'.csv': 'sheet',
	'.docx': 'doc',
	'.pptx': 'slides',
};

const FILE_PATTERN = /\.(?:html?|pdf|xlsx?|csv|docx|pptx)\b/i;
const ARTIFACT_URL = /https:\/\/claude\.ai\/(?:code\/)?artifact\/([A-Za-z0-9_-]+)/;
/** Folders whose files are build output or dependencies, never something made for you. */
const SKIP_FOLDERS = /\/(?:node_modules|dist|build|test-results|playwright-report|coverage)\//;

interface PageFinding {
	artifactId: string;
	url: string;
	title?: string;
	source?: string;
	ts: number;
}

interface FileFinding {
	file: string;
	ts: number;
}

interface ChatFindings {
	size: number;
	mtimeMs: number;
	chatId: string;
	pages: PageFinding[];
	deleted: { artifactId: string; ts: number }[];
	files: FileFinding[];
}

interface Block {
	type?: string;
	id?: string;
	name?: string;
	input?: Record<string, unknown>;
	tool_use_id?: string;
	content?: unknown;
	is_error?: boolean;
	text?: string;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const resultText = (content: unknown): string =>
	typeof content === 'string'
		? content
		: Array.isArray(content)
			? (content as { text?: string }[]).map((part) => text(part?.text)).join('\n')
			: '';

/** File paths an agent pointed to in a reply: Markdown link targets and absolute paths. */
export function filesMentioned(reply: string, cwd: string): string[] {
	const found = new Set<string>();
	const add = (raw: string) => {
		let target = raw.trim().replace(/^file:\/\//, '');
		if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) return;
		target = target.replace(/[#?].*$/, '');
		try {
			target = decodeURIComponent(target);
		} catch {
			// Not percent-encoded after all; use it as written.
		}
		if (target.startsWith('~/')) target = path.join(os.homedir(), target.slice(2));
		if (!KIND_BY_EXTENSION[path.extname(target).toLowerCase()]) return;
		found.add(path.resolve(cwd || '/', target));
	};
	for (const match of reply.matchAll(/\]\(<?([^)>\n]+?)>?\)/g)) add(match[1]!);
	for (const match of reply.matchAll(
		/(?:^|[\s`'"(])((?:~|\/)[^\s`'"()<>]+\.[A-Za-z]{3,4})(?=$|[\s`'").,;:])/gm
	))
		add(match[1]!);
	return [...found];
}

/** Reads one saved chat and keeps only what belongs in the library. */
export function scanChat(content: string, chatId: string): Omit<ChatFindings, 'size' | 'mtimeMs'> {
	const pages: PageFinding[] = [];
	const deleted: ChatFindings['deleted'] = [];
	const files: FileFinding[] = [];
	const publishing = new Map<string, { input: Record<string, unknown>; ts: number }>();
	const titles = new Map<string, string>();

	let start = 0;
	while (start < content.length) {
		let end = content.indexOf('\n', start);
		if (end < 0) end = content.length;
		const line = content.slice(start, end);
		start = end + 1;
		// Most lines hold nothing of interest; parsing only the ones that might keeps this quick.
		const worth =
			line.includes('"Artifact"') ||
			(publishing.size > 0 && line.includes('"tool_result"')) ||
			((line.includes('"type":"assistant"') || line.includes('"Write"')) &&
				FILE_PATTERN.test(line));
		if (!worth) continue;
		let record: { timestamp?: string; cwd?: string; message?: { content?: unknown } };
		try {
			record = JSON.parse(line) as typeof record;
		} catch {
			continue;
		}
		const blocks = record.message?.content;
		if (!Array.isArray(blocks)) continue;
		const ts = Date.parse(record.timestamp ?? '') || 0;
		for (const block of blocks as Block[]) {
			if (block.type === 'tool_use' && block.name === 'Artifact' && block.id) {
				const input = block.input ?? {};
				const action = text(input.action) || 'publish';
				const known = ARTIFACT_URL.exec(text(input.url))?.[1];
				if (action === 'delete' && known && !input.path) deleted.push({ artifactId: known, ts });
				else if (action === 'publish' && !input.asset) publishing.set(block.id, { input, ts });
			} else if (block.type === 'tool_use' && block.name === 'Write') {
				const file = text(block.input?.file_path);
				if (file && KIND_BY_EXTENSION[path.extname(file).toLowerCase()]) files.push({ file, ts });
			} else if (block.type === 'tool_result' && block.tool_use_id) {
				const call = publishing.get(block.tool_use_id);
				if (!call) continue;
				publishing.delete(block.tool_use_id);
				const said = resultText(block.content);
				const url = ARTIFACT_URL.exec(text(call.input.url)) ?? ARTIFACT_URL.exec(said);
				// A publish that was refused, or changed nothing, did not make or update a page.
				if (block.is_error || !url || /refused|nothing was published/i.test(said.slice(0, 300)))
					continue;
				const artifactId = url[1]!;
				const title = text(call.input.title).trim();
				if (title) titles.set(artifactId, title);
				const source = text(call.input.file_path);
				pages.push({
					artifactId,
					url: `https://claude.ai/artifact/${artifactId}`,
					title: titles.get(artifactId),
					source: /\.html?$/i.test(source) ? source : undefined,
					ts: call.ts || ts,
				});
			} else if (block.type === 'text' && block.text && FILE_PATTERN.test(block.text)) {
				for (const file of filesMentioned(block.text, record.cwd ?? '')) files.push({ file, ts });
			}
		}
	}
	return { chatId, pages, deleted, files };
}

/** "billing-map.html" → "Billing map", for a page whose own title cannot be read. */
export function titleFromFile(file: string): string {
	const name = path.basename(file, path.extname(file));
	// "index" says nothing; the folder it sits in usually names the thing.
	const words = (/^index$/i.test(name) ? path.basename(path.dirname(file)) : name)
		.replace(/[-_]+/g, ' ')
		.trim();
	return words ? words[0]!.toUpperCase() + words.slice(1) : 'Untitled';
}

const ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
};

const decodeEntities = (value: string) =>
	value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
		if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? whole;
		const point = /^#x/i.test(code) ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
		return Number.isFinite(point) && point > 0 && point < 0x110000
			? String.fromCodePoint(point)
			: whole;
	});

async function htmlTitle(file: string): Promise<string | undefined> {
	try {
		const handle = await fs.open(file, 'r');
		try {
			const buffer = Buffer.alloc(8192);
			const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
			const found = /<title[^>]*>([^<]{1,200})<\/title>/i.exec(
				buffer.subarray(0, bytesRead).toString('utf8')
			);
			return (
				decodeEntities(found?.[1] ?? '')
					.replace(/\s+/g, ' ')
					.trim() || undefined
			);
		} finally {
			await handle.close();
		}
	} catch {
		return undefined;
	}
}

export interface ArtifactIndexOptions {
	/** Claude Code's folder of saved chats. */
	projectsDir?: string;
	/** Says whether a file may be opened through the file route; others are left out. */
	canServe?: (file: string) => Promise<boolean>;
	/** Titles of chats by id, to say where an artifact came from. */
	chatTitles?: () => Promise<Map<string, string>>;
	/**
	 * A folder to keep a copy of each published page's source in. Agents often write a page to
	 * a temporary folder that is cleared later; the copy keeps its preview working.
	 */
	keepDir?: string;
}

/** A published page's source is copied only while it is small enough to be a page. */
const MAX_KEPT_BYTES = 8 * 1024 * 1024;

export class ArtifactIndex {
	private readonly chats = new Map<string, ChatFindings>();
	private running: Promise<ArtifactItem[]> | undefined;
	private readonly projectsDir: string;

	constructor(private readonly options: ArtifactIndexOptions = {}) {
		this.projectsDir =
			options.projectsDir ??
			path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'), 'projects');
	}

	/** The library, newest first. Only chats that changed since the last call are read again. */
	list(): Promise<ArtifactItem[]> {
		this.running ??= this.build().finally(() => {
			this.running = undefined;
		});
		return this.running;
	}

	private async refresh(): Promise<void> {
		const present = new Set<string>();
		for (const folder of await fs.readdir(this.projectsDir).catch(() => [] as string[])) {
			const dir = path.join(this.projectsDir, folder);
			for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
				if (!name.endsWith('.jsonl')) continue;
				const file = path.join(dir, name);
				const stat = await fs.stat(file).catch(() => undefined);
				if (!stat?.isFile()) continue;
				present.add(file);
				const known = this.chats.get(file);
				if (known && known.size === stat.size && known.mtimeMs === stat.mtimeMs) continue;
				const content = await fs.readFile(file, 'utf8').catch(() => '');
				this.chats.set(file, {
					size: stat.size,
					mtimeMs: stat.mtimeMs,
					...scanChat(content, path.basename(name, '.jsonl')),
				});
			}
		}
		for (const file of this.chats.keys()) if (!present.has(file)) this.chats.delete(file);
	}

	/**
	 * Keeps a copy of a page's source while it exists. Answers with the source when it is still
	 * there, else with the copy kept earlier.
	 */
	private async keep(artifactId: string, source: string | undefined): Promise<string | undefined> {
		const dir = this.options.keepDir;
		if (!dir) return source;
		const kept = path.join(dir, `${artifactId}.html`);
		try {
			if (source) {
				const [from, to] = await Promise.all([
					fs.stat(source),
					fs.stat(kept).catch(() => undefined),
				]);
				if (from.size <= MAX_KEPT_BYTES && (!to || from.mtimeMs > to.mtimeMs)) {
					await fs.mkdir(dir, { recursive: true, mode: 0o700 });
					await fs.copyFile(source, kept);
					await fs.chmod(kept, 0o600);
				}
				return source;
			}
			return (await fs.stat(kept)).isFile() ? kept : undefined;
		} catch {
			return source;
		}
	}

	private async build(): Promise<ArtifactItem[]> {
		await this.refresh();
		const titles = (await this.options.chatTitles?.().catch(() => undefined)) ?? new Map();
		const canServe = this.options.canServe ?? (async () => true);
		const exists = async (file: string) =>
			!SKIP_FOLDERS.test(file) &&
			!file.split(path.sep).some((part) => part.startsWith('.') && part.length > 1) &&
			(await fs.stat(file).then(
				(s) => s.isFile() && s.size > 0,
				() => false
			)) &&
			(await canServe(file));

		// Pages: the latest publish of each, unless it was deleted afterwards.
		const pages = new Map<string, PageFinding & { chatId: string }>();
		const removed = new Map<string, number>();
		for (const chat of this.chats.values()) {
			for (const gone of chat.deleted)
				removed.set(gone.artifactId, Math.max(removed.get(gone.artifactId) ?? 0, gone.ts));
			for (const page of chat.pages) {
				const seen = pages.get(page.artifactId);
				if (!seen || page.ts >= seen.ts)
					pages.set(page.artifactId, {
						...page,
						title: page.title ?? seen?.title,
						source: page.source ?? seen?.source,
						chatId: chat.chatId,
					});
				else if (!seen.title && page.title) seen.title = page.title;
			}
		}
		const items: ArtifactItem[] = [];
		const sources = new Set<string>();
		for (const page of pages.values()) {
			if ((removed.get(page.artifactId) ?? -1) >= page.ts) continue;
			if (page.source) sources.add(page.source);
			const file = await this.keep(
				page.artifactId,
				page.source && (await exists(page.source)) ? page.source : undefined
			);
			items.push({
				id: `page:${page.artifactId}`,
				kind: 'page',
				title:
					page.title ??
					(file ? await htmlTitle(file) : undefined) ??
					(page.source ? titleFromFile(page.source) : 'Untitled page'),
				url: page.url,
				file,
				updatedAt: page.ts,
				chatId: page.chatId,
				chatTitle: titles.get(page.chatId),
			});
		}

		// Files: each once, from the chat that touched it last. A page's own source is not repeated.
		const files = new Map<string, { ts: number; chatId: string }>();
		for (const chat of this.chats.values())
			for (const found of chat.files) {
				const seen = files.get(found.file);
				if (!seen || found.ts > seen.ts)
					files.set(found.file, { ts: found.ts, chatId: chat.chatId });
			}
		for (const [file, from] of files) {
			if (sources.has(file) || !(await exists(file))) continue;
			const kind = KIND_BY_EXTENSION[path.extname(file).toLowerCase()]!;
			const stat = await fs.stat(file);
			items.push({
				id: `file:${file}`,
				kind,
				title: (kind === 'page' ? await htmlTitle(file) : undefined) ?? titleFromFile(file),
				file,
				updatedAt: Math.round(stat.mtimeMs),
				chatId: from.chatId,
				chatTitle: titles.get(from.chatId),
			});
		}
		return items.sort((a, b) => b.updatedAt - a.updatedAt);
	}
}
