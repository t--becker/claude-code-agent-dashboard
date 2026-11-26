import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ServerConfig {
	port: number;
	host: string;
	dataDir: string;
	repoRoot: string;
	forceDemo: boolean;
	autoMirror: boolean;
	demoTurnMs: number;
	userName: string;
	staticDir: string;
	production: boolean;
	/** Whether New agent may open this machine's folder chooser (macOS; FOLDER_PICKER=off disables). */
	folderPicker: boolean;
}

const here = path.dirname(fileURLToPath(import.meta.url));

/** Where projects usually live: the first of these that exists, else the home folder itself. */
const PROJECT_FOLDERS = [
	'repo',
	'repos',
	'projects',
	'code',
	'dev',
	'src',
	'Developer',
	'Documents',
];

export function defaultProjectsFolder(
	home: string,
	exists: (file: string) => boolean = fs.existsSync
): string {
	const found = PROJECT_FOLDERS.find((name) => exists(path.join(home, name)));
	return found ? path.join(home, found) : home;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
	const home = os.homedir();
	return {
		port: Number(env.PORT ?? 4848),
		host: env.HOST ?? '127.0.0.1',
		dataDir: env.DATA_DIR ?? path.join(home, '.agent-workspace'),
		repoRoot: env.REPO_ROOT ?? defaultProjectsFolder(home),
		forceDemo: env.FORCE_DEMO === '1' || env.FORCE_DEMO === 'true',
		autoMirror: !(env.AUTO_MIRROR === '0' || env.AUTO_MIRROR === 'false'),
		demoTurnMs: Number(env.DEMO_TURN_MS ?? 6000),
		userName: env.WORKSPACE_USER ?? os.userInfo().username,
		staticDir: path.resolve(here, '..', 'dist', 'web'),
		production: env.NODE_ENV === 'production',
		folderPicker: process.platform === 'darwin' && env.FOLDER_PICKER !== 'off',
	};
}
