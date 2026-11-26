import { execFile } from 'node:child_process';

export interface PickedFolder {
	path?: string;
	cancelled?: boolean;
}

// The start folder is passed as an argument, never spliced into the script text.
const SCRIPT = [
	'on run argv',
	'tell me to activate',
	'POSIX path of (choose folder with prompt "Choose the project folder for the new agent" default location (POSIX file (item 1 of argv)))',
	'end run',
];

let open: Promise<PickedFolder> | undefined;

/**
 * Opens the macOS folder chooser on this machine and resolves with the folder picked.
 * A browser page cannot do this itself: its own folder picker never reveals the real path,
 * and an agent needs one.
 */
export function pickFolder(startDir: string): Promise<PickedFolder> {
	// One chooser at a time; a second click while it is open waits for the same answer.
	open ??= new Promise<PickedFolder>((resolve, reject) => {
		const args = SCRIPT.flatMap((line) => ['-e', line]);
		execFile('osascript', [...args, '--', startDir], { timeout: 10 * 60_000 }, (err, stdout) => {
			if (!err) {
				const picked = stdout.trim().replace(/\/+$/, '');
				return resolve(picked ? { path: picked } : { cancelled: true });
			}
			// Pressing Cancel ends the script with error -128.
			if (/-128|User canceled/i.test(String(err.message))) return resolve({ cancelled: true });
			reject(new Error(`The folder chooser could not open: ${err.message.trim()}`));
		});
	}).finally(() => {
		open = undefined;
	});
	return open;
}
