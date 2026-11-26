import fs from 'node:fs';
import path from 'node:path';
import { PERMISSION_MODES, type PermissionMode } from '@shared/types';

export interface Settings {
	/** Permission mode new and mirrored cards start in. */
	defaultPermissionMode: PermissionMode;
}

const DEFAULTS: Settings = { defaultPermissionMode: 'default' };

/** Workspace-wide choices that outlive a restart, kept beside the sessions file. */
export class SettingsStore {
	constructor(private readonly file: string) {}

	load(): Settings {
		try {
			const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<Settings>;
			const mode = parsed.defaultPermissionMode;
			// A hand-edited or damaged file falls back to asking, the careful choice.
			return PERMISSION_MODES.some((m) => m.id === mode)
				? { defaultPermissionMode: mode as PermissionMode }
				: { ...DEFAULTS };
		} catch {
			return { ...DEFAULTS };
		}
	}

	save(settings: Settings): void {
		fs.mkdirSync(path.dirname(this.file), { recursive: true });
		fs.writeFileSync(this.file, JSON.stringify(settings, null, '\t'), { mode: 0o600 });
	}
}
