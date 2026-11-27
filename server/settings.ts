import fs from 'node:fs';
import path from 'node:path';
import { PERMISSION_MODES, type PermissionMode } from '@shared/types';

export interface Settings {
	/** Permission mode new and mirrored cards start in. */
	defaultPermissionMode: PermissionMode;
	/**
	 * Claude Code model every card uses from its next prompt, and new and mirrored cards start
	 * on. Unset means each card keeps its own (a mirrored chat, the one it was using).
	 */
	defaultModel?: string;
}

const DEFAULTS: Settings = { defaultPermissionMode: 'default' };

/** Workspace-wide choices that outlive a restart, kept beside the sessions file. */
export class SettingsStore {
	constructor(private readonly file: string) {}

	load(): Settings {
		try {
			const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<Settings>;
			const mode = parsed.defaultPermissionMode;
			const model = typeof parsed.defaultModel === 'string' ? parsed.defaultModel.trim() : '';
			return {
				// A hand-edited or damaged file falls back to asking, the careful choice.
				defaultPermissionMode: PERMISSION_MODES.some((m) => m.id === mode)
					? (mode as PermissionMode)
					: DEFAULTS.defaultPermissionMode,
				...(model && model.length <= 120 ? { defaultModel: model } : {}),
			};
		} catch {
			return { ...DEFAULTS };
		}
	}

	save(settings: Settings): void {
		fs.mkdirSync(path.dirname(this.file), { recursive: true });
		fs.writeFileSync(this.file, JSON.stringify(settings, null, '\t'), { mode: 0o600 });
	}
}
