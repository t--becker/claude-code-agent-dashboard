import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
	PERMISSION_MODES,
	type PermissionMode,
	type PromptFile,
	type AnswerInput,
	type CreateSessionInput,
	type ProviderId,
	type ProviderInfo,
	type Session,
	type TranscriptEntry,
	type TranscriptEntryInput,
	type WorkspaceConfig,
} from '@shared/types';
import { isTopic, suggestTopic } from '@shared/topics';
import { AttachmentError, saveFiles, type SavedFile } from './attachments';
import type { EventBus } from './events';
import {
	ACTIVE_WINDOW_MS,
	applyToolResults,
	convertMessages,
	toOpenInfo,
	trimEntries,
	type ExternalSource,
} from './providers/claude_sessions';
import {
	STOPPED_ANSWER,
	type AskAnswer,
	type AskRequest,
	type Provider,
	type ProviderEvent,
	type RunContext,
	type RunHandle,
} from './providers/types';
import type { SessionStorage } from './store';

export class HttpError extends Error {
	constructor(
		readonly status: number,
		message: string
	) {
		super(message);
	}
}

interface ActiveRun {
	handle?: RunHandle;
	stopping: boolean;
	pending?: { request: AskRequest; resolve: (answer: AskAnswer) => void };
}

export interface ManagerDeps {
	store: SessionStorage;
	bus: EventBus;
	providers: Map<ProviderId, Provider>;
	providerInfos: () => ProviderInfo[];
	getBranch: (dir: string) => Promise<string>;
	/** Chats stored by Claude Code outside the workspace. */
	external?: ExternalSource;
	/** Mirror every open chat without being asked (default true when `external` is set). */
	autoMirror?: boolean;
	mirrorIntervalMs?: number;
	/** Where files attached to prompts are kept, one folder per agent. Without it, prompts are text only. */
	attachmentsDir?: string;
	/** Permission mode cards start in, as last chosen for the whole workspace. */
	defaultPermissionMode?: PermissionMode;
	/** Called when that choice changes, so it survives a restart. */
	saveDefaultPermissionMode?: (mode: PermissionMode) => void;
	log?: (message: string) => void;
}

export const FORK_NOTE =
	'Continuing this chat in the workspace as its own branch. The original chat keeps its own history.';

export const RESUME_PROMPT = 'Continue from where you stopped.';

/** Upper bound on entries kept per card; older ones fall off the front. */
const MAX_TRANSCRIPT = 2000;

const entry = (data: TranscriptEntryInput): TranscriptEntry =>
	({ id: randomUUID(), ts: Date.now(), ...data }) as TranscriptEntry;

const clone = <T>(value: T): T => structuredClone(value);

/**
 * Owns every session's lifecycle: state transitions, the transcript, provider
 * runs and pending questions. Closing a card is a flag here, never a stop.
 */
function assertPermissionMode(mode: string): asserts mode is PermissionMode {
	if (!PERMISSION_MODES.some((m) => m.id === mode)) {
		throw new HttpError(400, `Unknown permission mode: ${mode}`);
	}
}

export class SessionManager {
	private readonly sessions = new Map<string, Session>();
	private readonly runs = new Map<string, ActiveRun>();
	private mirrorTimer: NodeJS.Timeout | undefined;
	private mirrorBusy = false;
	/** External chats the user deleted or that cannot be imported; not retried until restart. */
	private readonly ignoredExternal = new Set<string>();
	/** Mirrored cards already rebuilt from their chat's full history this process. */
	private readonly rebuilt = new Set<string>();

	private defaultMode: PermissionMode;

	constructor(private readonly deps: ManagerDeps) {
		this.defaultMode = deps.defaultPermissionMode ?? 'default';
	}

	get defaultPermissionMode(): PermissionMode {
		return this.defaultMode;
	}

	/**
	 * Sets the permission mode on every card and makes it the starting mode for new and
	 * mirrored ones. Like a single card's change, it applies from each agent's next prompt.
	 */
	setPermissionModeForAll(mode: PermissionMode): Session[] {
		assertPermissionMode(mode);
		this.defaultMode = mode;
		this.deps.saveDefaultPermissionMode?.(mode);
		for (const session of this.sessions.values()) this.setPermissionMode(session.id, mode);
		return this.list();
	}

	/** Polls mirrored chats for new messages. Call once after init. */
	startMirroring(): void {
		if (this.mirrorTimer || !this.deps.external) return;
		this.mirrorTimer = setInterval(
			() => void this.syncMirrors(),
			this.deps.mirrorIntervalMs ?? 3000
		);
		this.mirrorTimer.unref();
		void this.syncMirrors();
	}

	stopMirroring(): void {
		if (this.mirrorTimer) clearInterval(this.mirrorTimer);
		this.mirrorTimer = undefined;
	}

	/** Turns an existing Claude Code chat into a card that mirrors it until you continue it here. */
	async importExternal(sessionId: string, options: { auto?: boolean } = {}): Promise<Session> {
		if (!this.deps.external) throw new HttpError(400, 'Importing chats is not available');
		const existing = [...this.sessions.values()].find(
			(s) => s.providerSessionId === sessionId || s.external?.sessionId === sessionId
		);
		if (existing) throw new HttpError(409, `Already in the workspace as “${existing.title}”`);
		const info = await this.deps.external.info(sessionId);
		if (!info) throw new HttpError(404, 'Chat not found');
		const openNow = (await this.deps.external.open()).find((o) => o.sessionId === sessionId);
		// Some saved chats record no folder; the process that has the chat open still knows it.
		const cwd = info.cwd ?? openNow?.cwd;
		const dir = cwd ? path.resolve(cwd) : '';
		const stat = dir ? await fs.stat(dir).catch(() => undefined) : undefined;
		if (!stat?.isDirectory())
			throw new HttpError(400, `The chat's folder no longer exists: ${cwd ?? 'unknown'}`);

		const provider = this.deps.providerInfos().find((p) => p.id === 'claude-code');
		if (!provider) throw new HttpError(400, 'Claude Code is unavailable');
		const messages = await this.deps.external.messages(sessionId);
		const converted = convertMessages(messages, info.createdAt ?? Date.now());
		const model =
			provider.models.find((m) => m.id === converted.lastModel)?.id ??
			provider.models.find((m) => m.resolves === converted.lastModel)?.id ??
			provider.defaultModel;

		const now = Date.now();
		const session: Session = {
			id: randomUUID(),
			title: info.title,
			project: path.basename(dir),
			path: dir,
			branch: info.branch || (await this.deps.getBranch(dir)),
			provider: 'claude-code',
			providerLabel: provider.label,
			providerMode: provider.mode,
			model,
			permissionMode: this.defaultMode,
			state: 'Done',
			closed: false,
			createdAt: now,
			updatedAt: now,
			turns: converted.prompts,
			providerSessionId: sessionId,
			external: {
				sessionId,
				lastModified: info.lastModified,
				active: now - info.lastModified < ACTIVE_WINDOW_MS,
				open: toOpenInfo(openNow),
				auto: options.auto || undefined,
				messageCount: messages.length,
				timed: true,
			},
			transcript: [
				entry({
					kind: 'system',
					text: `${options.auto ? 'Mirroring the open' : 'Mirroring the'} Claude Code chat “${info.title}” from ${dir}.`,
				}),
				...trimEntries(converted.entries),
			],
		};
		this.suggestIcon(session, converted.entries.find((item) => item.kind === 'user')?.text);
		this.sessions.set(session.id, session);
		this.ignoredExternal.delete(sessionId);
		this.commit(session);
		return clone(session);
	}

	private findExternal(sessionId: string): Session | undefined {
		return [...this.sessions.values()].find(
			(s) => s.providerSessionId === sessionId || s.external?.sessionId === sessionId
		);
	}

	/** Mirrors every open chat that has no card yet, and tracks cards whose chat has closed or come back. */
	private async autoMirror(open: { sessionId: string }[]): Promise<void> {
		if (this.deps.autoMirror === false) return;
		for (const chat of open) {
			if (this.ignoredExternal.has(chat.sessionId) || this.findExternal(chat.sessionId)) continue;
			try {
				await this.importExternal(chat.sessionId, { auto: true });
			} catch (err) {
				this.ignoredExternal.add(chat.sessionId);
				this.deps.log?.(
					`not mirroring ${chat.sessionId}: ${err instanceof Error ? err.message : String(err)}`
				);
			}
		}
		for (const session of this.sessions.values()) {
			const link = session.external;
			if (!link?.auto || this.runs.has(session.id)) continue;
			const stillOpen = open.some((o) => o.sessionId === link.sessionId);
			if (!stillOpen && !session.closed) {
				session.closed = true;
				session.transcript.push(
					entry({
						kind: 'system',
						text: 'The Claude Code chat closed; this card moved to Closed sessions.',
					})
				);
				this.commit(session);
			} else if (stillOpen && session.closed) {
				session.closed = false;
				session.transcript.push(
					entry({ kind: 'system', text: 'The Claude Code chat is open again.' })
				);
				this.commit(session);
			}
		}
	}

	/** Pulls anything new into mirrored cards and refreshes their active flag. */
	async syncMirrors(): Promise<void> {
		const external = this.deps.external;
		if (!external || this.mirrorBusy) return;
		this.mirrorBusy = true;
		try {
			const open = await external.open().catch(() => []);
			await this.autoMirror(open);
			for (const session of this.sessions.values()) {
				const link = session.external;
				if (!link || this.runs.has(session.id)) continue;
				const openInfo = toOpenInfo(open.find((o) => o.sessionId === link.sessionId));
				if (JSON.stringify(openInfo) !== JSON.stringify(link.open)) {
					link.open = openInfo;
					this.commit(session);
				}
				const info = await external.info(link.sessionId).catch(() => undefined);
				if (!info) continue;
				// Cards mirrored before tool outputs were recorded get their history re-read once.
				if (!this.rebuilt.has(session.id)) {
					this.rebuilt.add(session.id);
					if (
						!link.timed ||
						session.transcript.some((e) => e.kind === 'tool' && e.toolUseId === undefined)
					) {
						const all = await external.messages(link.sessionId).catch(() => undefined);
						if (all) {
							link.timed = true;
							const converted = convertMessages(all, info.createdAt ?? Date.now());
							const note = session.transcript[0];
							session.transcript = [
								...(note?.kind === 'system' && note.text.startsWith('Mirroring') ? [note] : []),
								...trimEntries(converted.entries),
							];
							link.messageCount = all.length;
							link.lastModified = info.lastModified;
							this.commit(session);
							continue;
						}
					}
				}
				let changed = false;
				if (info.lastModified !== link.lastModified) {
					const fresh = await external.messages(link.sessionId, link.messageCount).catch(() => []);
					if (fresh.length) {
						const converted = convertMessages(fresh, Date.now());
						session.transcript.push(...converted.entries);
						applyToolResults(session.transcript, converted.orphanResults);
						session.transcript = trimEntries(session.transcript, MAX_TRANSCRIPT);
						link.messageCount += fresh.length;
					}
					link.lastModified = info.lastModified;
					changed = true;
				}
				const active = Date.now() - info.lastModified < ACTIVE_WINDOW_MS;
				if (active !== link.active) {
					link.active = active;
					changed = true;
				}
				if (changed) this.commit(session);
			}
		} finally {
			this.mirrorBusy = false;
		}
	}

	/** Loads persisted sessions. A run cannot survive a server restart, so those come back as Stopped. */
	init(): void {
		for (const session of this.deps.store.load()) {
			if (session.state === 'Running' || session.state === 'Needs input') {
				session.state = 'Stopped';
				session.pendingInput = undefined;
				session.transcript.push(
					entry({
						kind: 'system',
						text: 'The workspace server restarted while this agent was working. Resume to continue.',
					})
				);
			}
			// The suggestion is worked out again at start-up, so a chat follows changes to the icon
			// set. One you picked yourself is left alone.
			this.suggestIcon(session);
			this.sessions.set(session.id, session);
		}
		this.persist();
	}

	list(): Session[] {
		return [...this.sessions.values()].sort((a, b) => b.createdAt - a.createdAt).map(clone);
	}

	get(id: string): Session {
		const session = this.sessions.get(id);
		if (!session) throw new HttpError(404, 'Agent not found');
		return session;
	}

	async create(input: CreateSessionInput): Promise<Session> {
		if (!input.path?.trim()) throw new HttpError(400, 'Choose the project folder');
		const prompt = input.prompt?.trim();

		// Claude Code unless asked otherwise; whichever tool exists if it is not set up here.
		const wanted = input.provider ?? 'claude-code';
		const infos = this.deps.providerInfos();
		const info = infos.find((p) => p.id === wanted) ?? (input.provider ? undefined : infos[0]);
		const provider = info && this.deps.providers.get(info.id);
		if (!provider || !info) throw new HttpError(400, `Unknown agent tool: ${wanted}`);
		const model = this.resolveModel(info, input.model);

		const permissionMode = input.permissionMode ?? this.defaultMode;
		assertPermissionMode(permissionMode);

		const dir = path.resolve(input.path.trim());
		const stat = await fs.stat(dir).catch(() => undefined);
		if (!stat?.isDirectory()) throw new HttpError(400, `Folder not found: ${dir}`);
		const folderName = path.basename(dir) || dir;
		const title = input.title?.trim();

		const now = Date.now();
		const session: Session = {
			id: randomUUID(),
			title: title || folderName,
			// Named after its folder for now; the first prompt gives it a real name.
			titleAuto: title ? undefined : true,
			project: input.project?.trim() || folderName,
			path: dir,
			branch: await this.deps.getBranch(dir),
			provider: info.id,
			providerLabel: info.label,
			providerMode: info.mode,
			model,
			permissionMode,
			state: prompt ? 'Running' : 'Done',
			closed: false,
			createdAt: now,
			updatedAt: now,
			turns: 0,
			transcript: [],
		};
		this.sessions.set(session.id, session);
		if (prompt) {
			this.nameFromPrompt(session, prompt);
			this.suggestIcon(session, prompt);
			this.startRun(session, prompt);
		} else {
			this.suggestIcon(session);
			this.commit(session);
		}
		return clone(session);
	}

	/** A chat still named after its folder takes its name from the first thing asked of it. */
	private nameFromPrompt(session: Session, text: string): void {
		if (!session.titleAuto) return;
		const line = text
			.split('\n')
			.map((l) => l.trim())
			.find(Boolean);
		if (!line) return;
		session.title = line.length > 60 ? `${line.slice(0, 59).trimEnd()}…` : line;
		session.titleAuto = undefined;
	}

	/**
	 * Suggests the topic icon from the chat's title and the first thing asked of it. A chat still
	 * named after its folder has nothing to go on yet, and an icon you picked is never replaced.
	 */
	private suggestIcon(session: Session, firstPrompt?: string): void {
		if (session.iconChosen || session.titleAuto) return;
		const first =
			firstPrompt ?? session.transcript.find((item) => item.kind === 'user')?.text ?? '';
		session.icon = suggestTopic(session.title, first);
	}

	/** Your own pick for a chat's icon, kept from then on. `null` hands it back to the suggestion. */
	setIcon(id: string, icon: string | null): Session {
		const session = this.get(id);
		if (icon === null) {
			session.iconChosen = undefined;
			session.icon = undefined;
			this.suggestIcon(session);
		} else {
			if (!isTopic(icon)) throw new HttpError(400, 'Unknown icon');
			session.icon = icon;
			session.iconChosen = true;
		}
		this.commit(session);
		return clone(session);
	}

	/** Any name the reader wants; it is theirs from then on, so nothing renames it again. */
	rename(id: string, title: string): Session {
		const session = this.get(id);
		const next = title?.trim().replace(/\s+/g, ' ');
		if (!next) throw new HttpError(400, 'A title cannot be empty');
		if (next.length > 120) throw new HttpError(400, 'Keep the title under 120 characters');
		if (next !== session.title || session.titleAuto) {
			session.title = next;
			session.titleAuto = undefined;
			this.suggestIcon(session);
			this.commit(session);
		}
		return clone(session);
	}

	async prompt(id: string, text: string, files: PromptFile[] = []): Promise<Session> {
		const session = this.get(id);
		const trimmed = text?.trim() ?? '';
		if (!trimmed && !files.length) throw new HttpError(400, 'Prompt is empty');
		this.assertIdle(session);
		let saved: SavedFile[] = [];
		if (files.length) {
			const dir = this.attachmentsDirFor(session);
			if (!dir) throw new HttpError(400, 'Files cannot be attached here');
			try {
				saved = await saveFiles(dir, files);
			} catch (err) {
				if (err instanceof AttachmentError) throw new HttpError(400, err.message);
				throw err;
			}
			// Saving took a moment; make sure nothing else started the agent meanwhile.
			this.assertIdle(session);
		}
		this.nameFromPrompt(session, trimmed);
		// The first prompt says what the chat is for; later ones leave its icon alone.
		const firstPrompt = !session.transcript.some((item) => item.kind === 'user');
		if (firstPrompt) this.suggestIcon(session, trimmed);
		else if (!session.icon) this.suggestIcon(session);
		if (session.nextModel && session.nextModel !== session.model) {
			session.model = session.nextModel;
			session.transcript.push(
				entry({ kind: 'system', text: `Model changed to ${this.modelLabel(session)}.` })
			);
		}
		session.nextModel = undefined;
		if (session.external) session.transcript.push(entry({ kind: 'system', text: FORK_NOTE }));
		this.startRun(session, trimmed, saved);
		return clone(session);
	}

	async stop(id: string): Promise<Session> {
		const session = this.get(id);
		const run = this.runs.get(id);
		if (!run || (session.state !== 'Running' && session.state !== 'Needs input')) {
			throw new HttpError(409, 'This agent is not running');
		}
		run.stopping = true;
		if (run.pending) {
			const pending = run.pending;
			run.pending = undefined;
			pending.resolve({ optionId: STOPPED_ANSWER });
		}
		session.pendingInput = undefined;
		session.state = 'Stopped';
		session.transcript.push(entry({ kind: 'system', text: 'Stopped by you.' }));
		this.commit(session);
		this.deps.bus.publish({ type: 'stream', sessionId: id, text: '' });
		this.deps.bus.publish({ type: 'activity', sessionId: id });
		await run.handle
			?.interrupt()
			.catch((err: unknown) => this.log(id, `interrupt failed: ${String(err)}`));
		return clone(session);
	}

	resume(id: string): Session {
		const session = this.get(id);
		if (session.state !== 'Stopped')
			throw new HttpError(409, 'Only a stopped agent can be resumed');
		this.startRun(session, RESUME_PROMPT);
		return clone(session);
	}

	close(id: string): Session {
		const session = this.get(id);
		session.closed = true;
		this.commit(session);
		return clone(session);
	}

	reopen(id: string): Session {
		const session = this.get(id);
		session.closed = false;
		this.commit(session);
		return clone(session);
	}

	async remove(id: string): Promise<void> {
		const session = this.get(id);
		if (!session.closed) throw new HttpError(409, 'Close the agent before deleting it');
		if (this.runs.has(id)) await this.stop(id).catch(() => undefined);
		if (session.external) this.ignoredExternal.add(session.external.sessionId);
		// The files sent to this agent go with it.
		for (const item of session.transcript) {
			if (item.kind !== 'user') continue;
			for (const file of [...(item.images ?? []), ...(item.files ?? []).map((f) => f.path)])
				await fs.rm(file, { force: true }).catch(() => undefined);
		}
		const folder = this.attachmentsDirFor(session);
		if (folder) await fs.rm(folder, { recursive: true, force: true }).catch(() => undefined);
		this.sessions.delete(id);
		this.runs.delete(id);
		this.persist();
		this.deps.bus.publish({
			type: 'session',
			session: { ...clone(session), closed: true, state: session.state },
		});
		this.deps.bus.publish({
			type: 'snapshot',
			providers: this.deps.providerInfos(),
			sessions: this.list(),
			config: this.lastConfig,
		});
	}

	/** Takes effect from the next prompt; a run already under way keeps the mode it started with. */
	setPermissionMode(id: string, mode: PermissionMode): Session {
		const session = this.get(id);
		assertPermissionMode(mode);
		if (mode !== session.permissionMode) {
			session.permissionMode = mode;
			const label = PERMISSION_MODES.find((m) => m.id === mode)?.label ?? mode;
			session.transcript.push(entry({ kind: 'system', text: `Permissions changed to ${label}.` }));
			this.commit(session);
		}
		return clone(session);
	}

	setNextModel(id: string, model: string): Session {
		const session = this.get(id);
		const info = this.deps.providerInfos().find((p) => p.id === session.provider);
		if (!info) throw new HttpError(400, 'Provider unavailable');
		const resolved = this.resolveModel(info, model);
		session.nextModel = resolved === session.model ? undefined : resolved;
		this.commit(session);
		return clone(session);
	}

	answer(id: string, input: AnswerInput): Session {
		const session = this.get(id);
		const run = this.runs.get(id);
		const pending = run?.pending;
		if (!run || !pending || session.state !== 'Needs input' || !session.pendingInput) {
			throw new HttpError(409, 'This agent is not waiting for input');
		}
		const option = input.optionId
			? pending.request.options.find((o) => o.id === input.optionId)
			: undefined;
		const text = input.text?.trim();
		if (!option && !(text && pending.request.allowFreeText)) {
			throw new HttpError(400, 'Choose one of the offered options');
		}
		run.pending = undefined;
		session.pendingInput = undefined;
		session.state = 'Running';
		session.transcript.push(
			entry({ kind: 'system', text: `You answered: ${option?.label ?? text}` })
		);
		this.commit(session);
		pending.resolve({ optionId: option?.id, text });
		return clone(session);
	}

	/** Snapshot the HTTP layer gives us so a removal can re-broadcast a full list. */
	lastConfig: WorkspaceConfig = {
		repoRoot: '',
		projects: [],
		userName: '',
		anyLive: false,
		folderPicker: false,
		defaultPermissionMode: 'default',
	};

	private modelLabel(session: Session): string {
		const info = this.deps.providerInfos().find((p) => p.id === session.provider);
		return info?.models.find((m) => m.id === session.model)?.label ?? session.model;
	}

	private resolveModel(info: ProviderInfo, requested: string | undefined): string {
		const model = requested?.trim() || info.defaultModel;
		if (!info.models.some((m) => m.id === model)) {
			throw new HttpError(400, `Model ${model} is not available for ${info.label}`);
		}
		return model;
	}

	private assertIdle(session: Session): void {
		if (session.state === 'Running' || session.state === 'Needs input') {
			throw new HttpError(409, 'This agent is busy. Stop it or wait for it to finish first.');
		}
	}

	private attachmentsDirFor(session: Session): string | undefined {
		return this.deps.attachmentsDir && path.join(this.deps.attachmentsDir, session.id);
	}

	private startRun(session: Session, text: string, files: SavedFile[] = []): void {
		const provider = this.deps.providers.get(session.provider);
		if (!provider) throw new HttpError(400, `Agent tool ${session.provider} is unavailable`);
		session.state = 'Running';
		session.lastError = undefined;
		session.pendingInput = undefined;
		const pictures = files.filter((file) => file.imageData);
		const others = files.filter((file) => !file.imageData);
		session.transcript.push(
			entry({
				kind: 'user',
				text,
				...(pictures.length ? { images: pictures.map((file) => file.path) } : {}),
				...(others.length
					? { files: others.map((file) => ({ path: file.path, name: file.name })) }
					: {}),
			})
		);
		this.commit(session);

		const run: ActiveRun = { stopping: false };
		this.runs.set(session.id, run);
		const ctx: RunContext = {
			session: clone(session),
			prompt: text,
			files,
			attachmentsDir: this.attachmentsDirFor(session),
			emit: (event) => this.onEvent(session.id, run, event),
			ask: (request) => this.onAsk(session.id, run, request),
			log: (message) => this.log(session.id, message),
		};
		try {
			run.handle = provider.run(ctx);
		} catch (err) {
			this.onEvent(session.id, run, {
				type: 'error',
				message: err instanceof Error ? err.message : String(err),
			});
		}
	}

	private onAsk(id: string, run: ActiveRun, request: AskRequest): Promise<AskAnswer> {
		const session = this.sessions.get(id);
		if (!session || this.runs.get(id) !== run || run.stopping) {
			return Promise.resolve({ optionId: STOPPED_ANSWER });
		}
		return new Promise((resolve) => {
			run.pending = { request, resolve };
			session.pendingInput = { id: randomUUID(), ...request };
			session.state = 'Needs input';
			this.commit(session);
		});
	}

	private onEvent(id: string, run: ActiveRun, event: ProviderEvent): void {
		const session = this.sessions.get(id);
		if (!session || this.runs.get(id) !== run) return;
		switch (event.type) {
			case 'init':
				session.providerSessionId = event.providerSessionId;
				// The run branched off a mirrored chat: the card now owns its own session.
				if (session.external && session.external.sessionId !== event.providerSessionId)
					session.external = undefined;
				break;
			case 'stream':
				if (!run.stopping)
					this.deps.bus.publish({ type: 'stream', sessionId: id, text: event.text });
				return;
			case 'activity':
				if (!run.stopping)
					this.deps.bus.publish({
						type: 'activity',
						sessionId: id,
						activity: { label: event.label, since: Date.now() },
					});
				return;
			case 'assistant':
				session.transcript.push(entry({ kind: 'assistant', text: event.text }));
				this.deps.bus.publish({ type: 'stream', sessionId: id, text: '' });
				break;
			case 'tool':
				session.transcript.push(
					entry({
						kind: 'tool',
						name: event.name,
						summary: event.summary,
						toolUseId: event.toolUseId,
						...(event.diff ? { diff: event.diff } : {}),
					})
				);
				break;
			case 'tool_result':
				applyToolResults(session.transcript, [event]);
				break;
			case 'done':
				this.runs.delete(id);
				session.turns += 1;
				if (event.costUsd !== undefined) session.costUsd = event.costUsd;
				if (!run.stopping) session.state = 'Done';
				void this.refreshBranch(session);
				break;
			case 'error':
				this.runs.delete(id);
				if (!run.stopping) {
					session.state = 'Error';
					session.lastError = event.message;
					session.transcript.push(entry({ kind: 'error', text: event.message }));
				}
				break;
			case 'stopped':
				this.runs.delete(id);
				session.state = 'Stopped';
				break;
		}
		if (event.type === 'done' || event.type === 'error' || event.type === 'stopped')
			this.deps.bus.publish({ type: 'activity', sessionId: id });
		this.commit(session);
	}

	private async refreshBranch(session: Session): Promise<void> {
		const branch = await this.deps.getBranch(session.path);
		if (branch !== session.branch && this.sessions.has(session.id)) {
			session.branch = branch;
			this.commit(session);
		}
	}

	private commit(session: Session): void {
		session.updatedAt = Date.now();
		this.persist();
		this.deps.bus.publish({ type: 'session', session: clone(session) });
	}

	private persist(): void {
		this.deps.store.save(this.list());
	}

	private log(id: string, message: string): void {
		this.deps.log?.(`[${id.slice(0, 8)}] ${message}`);
	}
}
