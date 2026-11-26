import type { ProviderInfo, Session } from '@shared/types';
import type { WorkspaceActions } from '../hooks/useWorkspace';

export const claudeProvider: ProviderInfo = {
	id: 'claude-code',
	label: 'Claude Code',
	mode: 'live',
	models: [
		{ id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
		{ id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
	],
	defaultModel: 'claude-sonnet-5-5',
	modelsSource: 'Claude Code supportedModels()',
	supportsPermissionModes: true,
};

export const codexDemoProvider: ProviderInfo = {
	id: 'codex',
	label: 'Codex',
	mode: 'demo',
	reason: 'codex CLI is not installed',
	models: [{ id: 'gpt-5.2-codex', label: 'gpt-5.2-codex' }],
	defaultModel: 'gpt-5.2-codex',
	modelsSource: '~/.codex/models_cache.json',
	supportsPermissionModes: true,
};

export function makeSession(overrides: Partial<Session> = {}): Session {
	const now = Date.now();
	return {
		id: 'session-1',
		title: 'Storefront help links',
		project: 'storefront',
		path: '/Users/me/projects/storefront',
		branch: 'feature/help-links',
		provider: 'claude-code',
		providerLabel: 'Claude Code',
		providerMode: 'live',
		model: 'claude-sonnet-5-5',
		permissionMode: 'default',
		state: 'Running',
		closed: false,
		createdAt: now - 20_000,
		updatedAt: now - 20_000,
		turns: 0,
		transcript: [
			{ id: 'e1', ts: now - 20_000, kind: 'user', text: 'Update the help links' },
			{ id: 'e2', ts: now - 19_000, kind: 'tool', name: 'Grep', summary: 'help-link in src' },
			{ id: 'e3', ts: now - 18_000, kind: 'assistant', text: 'I located the help links.' },
		],
		...overrides,
	};
}

export function makeActions(): WorkspaceActions {
	return {
		create: vi.fn(async () => makeSession()),
		prompt: vi.fn(async () => undefined),
		rename: vi.fn(async () => undefined),
		setIcon: vi.fn(async () => undefined),
		pickFolder: vi.fn(async () => ({ cancelled: true })),
		stop: vi.fn(async () => undefined),
		resume: vi.fn(async () => undefined),
		close: vi.fn(async () => undefined),
		reopen: vi.fn(async () => undefined),
		setModel: vi.fn(async () => undefined),
		setPermissionMode: vi.fn(async () => undefined),
		setAllPermissions: vi.fn(async () => undefined),
		answer: vi.fn(async () => undefined),
		remove: vi.fn(async () => undefined),
	};
}
