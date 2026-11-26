import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type { ProviderInfo, Session } from '@shared/types';
import { EventBus } from './events';
import { DemoProvider } from './providers/demo';
import type {
	ExternalMessage,
	ExternalSessionInfo,
	ExternalSource,
	OpenSession,
} from './providers/claude_sessions';
import type { Provider } from './providers/types';
import { SessionManager } from './session_manager';
import type { SessionStorage } from './store';

export function makeSession(overrides: Partial<Session> = {}): Session {
	const now = Date.now();
	return {
		id: randomUUID(),
		title: 'Storefront help links',
		project: 'storefront',
		path: '/Users/me/projects/storefront',
		branch: 'feature/help-links',
		provider: 'claude-code',
		providerLabel: 'Claude Code',
		providerMode: 'demo',
		model: 'claude-sonnet-5-5',
		permissionMode: 'default',
		state: 'Done',
		closed: false,
		createdAt: now,
		updatedAt: now,
		turns: 1,
		transcript: [],
		...overrides,
	};
}

export class MemoryStore implements SessionStorage {
	saved: Session[][] = [];
	constructor(private initial: Session[] = []) {}
	load(): Session[] {
		return structuredClone(this.initial);
	}
	save(sessions: Session[]): void {
		this.saved.push(sessions);
	}
	get latest(): Session[] {
		return this.saved[this.saved.length - 1] ?? [];
	}
}

export const DEMO_MODELS = [
	{ id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
	{ id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
	{ id: 'fable', label: 'Fable 5.1', resolves: 'claude-fable-5-1' },
];

/** In-memory stand-in for the chats Claude Code keeps on disk. */
export class FakeExternalSource implements ExternalSource {
	readonly chats = new Map<string, { info: ExternalSessionInfo; messages: ExternalMessage[] }>();
	openNow: OpenSession[] = [];
	async open(): Promise<OpenSession[]> {
		return this.openNow;
	}
	add(info: ExternalSessionInfo, messages: ExternalMessage[] = []): void {
		this.chats.set(info.sessionId, { info, messages });
	}
	async list(limit: number): Promise<ExternalSessionInfo[]> {
		return [...this.chats.values()].map((c) => c.info).slice(0, limit);
	}
	async info(sessionId: string): Promise<ExternalSessionInfo | undefined> {
		return this.chats.get(sessionId)?.info;
	}
	async messages(sessionId: string, offset = 0): Promise<ExternalMessage[]> {
		return (this.chats.get(sessionId)?.messages ?? []).slice(offset);
	}
}

export function makeDemoProvider(turnMs = 120): DemoProvider {
	return new DemoProvider({
		id: 'claude-code',
		label: 'Claude Code',
		reason: 'test',
		models: DEMO_MODELS,
		defaultModel: DEMO_MODELS[0]!.id,
		modelsSource: 'test list',
		turnMs,
	});
}

export async function makeManager(
	options: {
		initial?: Session[];
		provider?: Provider;
		turnMs?: number;
		external?: ExternalSource;
		autoMirror?: boolean;
	} = {}
) {
	const provider = options.provider ?? makeDemoProvider(options.turnMs);
	const info: ProviderInfo = await provider.detect();
	const store = new MemoryStore(options.initial);
	const bus = new EventBus();
	const manager = new SessionManager({
		store,
		bus,
		providers: new Map([[provider.id, provider]]),
		providerInfos: () => [info],
		getBranch: async () => 'main',
		external: options.external,
		autoMirror: options.autoMirror,
		attachmentsDir: path.join(os.tmpdir(), 'aw-test-attachments'),
	});
	manager.init();
	return { manager, store, bus, info, tmpDir: os.tmpdir() };
}
