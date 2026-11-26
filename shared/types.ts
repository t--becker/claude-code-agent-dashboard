// Types shared by the server and the web client. The server is the source of
// truth for sessions; the client only adds per-browser UI state on top.

export type AgentState = 'Running' | 'Needs input' | 'Stopped' | 'Done' | 'Error';

export const AGENT_STATES: AgentState[] = ['Running', 'Needs input', 'Stopped', 'Done', 'Error'];

export type ProviderId = 'claude-code' | 'codex';

export type ProviderMode = 'live' | 'demo';

export type PermissionMode = 'default' | 'auto' | 'acceptEdits' | 'plan' | 'bypassPermissions';

export const PERMISSION_MODES: { id: PermissionMode; label: string }[] = [
	{ id: 'default', label: 'Ask before edits and commands' },
	{ id: 'auto', label: 'Auto (a classifier approves routine calls)' },
	{ id: 'acceptEdits', label: 'Auto-accept file edits' },
	{ id: 'plan', label: 'Plan only (no changes)' },
	{ id: 'bypassPermissions', label: 'Bypass all permission checks' },
];

export interface ModelOption {
	id: string;
	label: string;
	description?: string;
	/** Wire model id an alias row resolves to, when the provider reports one. */
	resolves?: string;
}

/** A Claude Code process that currently has a chat open. */
export interface OpenInfo {
	pid: number;
	status: string;
	/** When the process last switched between busy and idle. */
	statusSince?: number;
	client?: string;
	name?: string;
}

/** Link from a workspace card to the external chat it mirrors. */
export interface ExternalLink {
	sessionId: string;
	lastModified: number;
	active: boolean;
	open?: OpenInfo;
	/** Mirrored automatically because the chat was open; its card follows the chat's process. */
	auto?: boolean;
	/** Raw provider messages already converted into the transcript. */
	messageCount: number;
	/** True once the transcript carries each message's own time, read from the saved chat. */
	timed?: boolean;
}

export interface ProviderInfo {
	id: ProviderId;
	label: string;
	mode: ProviderMode;
	/** Why the provider runs in demo mode. Only set when mode is 'demo'. */
	reason?: string;
	models: ModelOption[];
	defaultModel: string;
	/** Where the model list came from, for the UI footnote. */
	modelsSource: string;
	supportsPermissionModes: boolean;
}

export interface TranscriptEntryBase {
	id: string;
	ts: number;
}

export type TranscriptEntry =
	| (TranscriptEntryBase & {
			kind: 'user';
			text: string;
			/** Saved copies of the pictures sent with this prompt, as absolute paths. */
			images?: string[];
			/** Every other file sent with this prompt. */
			files?: SentFile[];
	  })
	| (TranscriptEntryBase & { kind: 'assistant'; text: string })
	| (TranscriptEntryBase & {
			kind: 'tool';
			name: string;
			summary: string;
			toolUseId?: string;
			/** For a tool that edits a file: the lines it takes out (`-`) and puts in (`+`), clipped. */
			diff?: string;
			/** What the tool returned, clipped; undefined until the result arrives. */
			output?: string;
			isError?: boolean;
	  })
	| (TranscriptEntryBase & { kind: 'system'; text: string })
	| (TranscriptEntryBase & { kind: 'error'; text: string });

/** Omit that distributes over a union, so each transcript shape keeps its own fields. */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type TranscriptEntryInput = DistributiveOmit<TranscriptEntry, 'id' | 'ts'>;

export interface PendingOption {
	id: string;
	label: string;
	description?: string;
}

export interface PendingInput {
	id: string;
	kind: 'permission' | 'question';
	title: string;
	detail?: string;
	toolName?: string;
	options: PendingOption[];
	allowFreeText: boolean;
}

export interface Session {
	id: string;
	title: string;
	/** True while the title is only the folder name; the first prompt then names the chat. */
	titleAuto?: boolean;
	/** Topic icon beside the title: an id from `shared/topics.ts`. Unset until there is something to go on. */
	icon?: string;
	/** True once you picked the icon yourself; nothing changes it after that. */
	iconChosen?: boolean;
	project: string;
	path: string;
	branch: string;
	provider: ProviderId;
	providerLabel: string;
	providerMode: ProviderMode;
	model: string;
	/** Model to use for the next prompt. Never changes an in-progress run. */
	nextModel?: string;
	permissionMode: PermissionMode;
	state: AgentState;
	closed: boolean;
	createdAt: number;
	updatedAt: number;
	turns: number;
	costUsd?: number;
	lastError?: string;
	/** Provider-side conversation id used to resume (Claude session id, Codex thread id). */
	providerSessionId?: string;
	/** Set while the card mirrors a chat that lives outside the workspace. */
	external?: ExternalLink;
	pendingInput?: PendingInput;
	transcript: TranscriptEntry[];
}

export interface WorkspaceConfig {
	repoRoot: string;
	projects: string[];
	anyLive: boolean;
	/** Address of your own picture for your side of the chat, when the data folder holds one. */
	avatar?: string;
	/** Your own pictures for topic icons, by topic id, when the data folder holds any. */
	logos?: Record<string, string>;
	/** True when the server can open this machine's own folder chooser for a new agent. */
	folderPicker: boolean;
	/** Permission mode new and mirrored cards start in; set for every card at once from the header. */
	defaultPermissionMode: PermissionMode;
}

/** Only the folder is needed. Everything else has a default and can be changed on the card. */
export interface CreateSessionInput {
	path: string;
	title?: string;
	project?: string;
	provider?: ProviderId;
	model?: string;
	permissionMode?: PermissionMode;
	/** Starts the first turn straight away. Without it the card waits for you to type. */
	prompt?: string;
}

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
/** Most files one prompt can carry, pictures included. */
export const MAX_FILES = 10;
/** Largest picture the model is shown directly; a bigger one is handed over as a file. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Largest single file, and the most one prompt can carry in total. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

/** A file attached to a prompt and saved on this machine, as the transcript records it. */
export interface SentFile {
	path: string;
	name: string;
}

/** A file of any type attached to a prompt, as the browser sends it. */
export interface PromptFile {
	name: string;
	mediaType: string;
	/** Base64, without a `data:` prefix. */
	data: string;
}

export interface AnswerInput {
	optionId?: string;
	text?: string;
}

export interface BootstrapResponse {
	providers: ProviderInfo[];
	sessions: Session[];
	config: WorkspaceConfig;
}

/**
 * What a running agent is doing right now, as a short status label such as "Thinking" or
 * "Running Bash". It names the step only; it never carries the model's reasoning or output.
 */
export interface Activity {
	label: string;
	/** When this step started, so the card can show how long it has been going. */
	since: number;
}

export type ServerEvent =
	| { type: 'snapshot'; providers: ProviderInfo[]; sessions: Session[]; config: WorkspaceConfig }
	| { type: 'session'; session: Session }
	| { type: 'stream'; sessionId: string; text: string }
	/** `activity` is absent once the run has ended. */
	| { type: 'activity'; sessionId: string; activity?: Activity };

export function latestAssistantText(session: Session): string | undefined {
	for (let i = session.transcript.length - 1; i >= 0; i -= 1) {
		const entry = session.transcript[i];
		if (entry?.kind === 'assistant') return entry.text;
	}
	return undefined;
}

/** Tool steps since the last user prompt, so a card shows only the current turn's activity. */
export function currentTurnSteps(session: Session): TranscriptEntry[] {
	const steps: TranscriptEntry[] = [];
	for (let i = session.transcript.length - 1; i >= 0; i -= 1) {
		const entry = session.transcript[i];
		if (!entry || entry.kind === 'user') break;
		if (entry.kind === 'tool') steps.unshift(entry);
	}
	return steps;
}

/** Where the server serves files from this machine; the file's absolute path follows it. */
export const FILE_ROUTE = '/api/files';
