import fs from 'node:fs';
import path from 'node:path';
import type { Session } from '@shared/types';

interface StoreFile {
	version: 1;
	sessions: Session[];
}

export interface SessionStorage {
	load(): Session[];
	save(sessions: Session[]): void;
}

/** JSON file persistence. Writes go to a temp file then rename, so a crash never leaves a half-written store. */
export class SessionStore implements SessionStorage {
	private timer: NodeJS.Timeout | undefined;
	private pending: Session[] | undefined;

	constructor(
		private readonly file: string,
		private readonly debounceMs = 100
	) {}

	load(): Session[] {
		if (!fs.existsSync(this.file)) return [];
		const raw = fs.readFileSync(this.file, 'utf8');
		if (!raw.trim()) return [];
		const parsed = JSON.parse(raw) as StoreFile;
		return Array.isArray(parsed.sessions) ? parsed.sessions : [];
	}

	save(sessions: Session[]): void {
		this.pending = sessions;
		if (this.timer) return;
		this.timer = setTimeout(() => this.flush(), this.debounceMs);
	}

	flush(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
		if (!this.pending) return;
		const sessions = this.pending;
		this.pending = undefined;
		fs.mkdirSync(path.dirname(this.file), { recursive: true });
		const tmp = `${this.file}.${process.pid}.tmp`;
		const body: StoreFile = { version: 1, sessions };
		fs.writeFileSync(tmp, JSON.stringify(body, null, '\t'), { mode: 0o600 });
		fs.renameSync(tmp, this.file);
	}
}
