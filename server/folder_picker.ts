import { execFile } from 'node:child_process';

export interface PickedFolder {
	path?: string;
	cancelled?: boolean;
}

// The start folder is passed as an argument, never spliced into the script text.
//
// Written in JavaScript for Automation so the chooser can be brought to the front with AppKit's
// own call. AppleScript's "tell me to activate" does the same but holds the chooser back by about
// two seconds; this way it appears in under one, still in front of the browser.
const SCRIPT = [
	'function run(argv) {',
	"	ObjC.import('AppKit');",
	'	$.NSApplication.sharedApplication.activateIgnoringOtherApps(true);',
	'	const app = Application.currentApplication();',
	'	app.includeStandardAdditions = true;',
	'	return app',
	'		.chooseFolder({',
	"			withPrompt: 'Choose the project folder for the new agent',",
	'			defaultLocation: Path(argv[0]),',
	'		})',
	'		.toString();',
	'}',
].join('\n');

let open: Promise<PickedFolder> | undefined;

/**
 * Opens the macOS folder chooser on this machine and resolves with the folder picked.
 * A browser page cannot do this itself: its own folder picker never reveals the real path,
 * and an agent needs one.
 */
export function pickFolder(startDir: string): Promise<PickedFolder> {
	// One chooser at a time; a second click while it is open waits for the same answer.
	open ??= new Promise<PickedFolder>((resolve, reject) => {
		const args = ['-l', 'JavaScript', '-e', SCRIPT, startDir];
		execFile('osascript', args, { timeout: 10 * 60_000 }, (err, stdout) => {
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
