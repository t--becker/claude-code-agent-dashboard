#!/usr/bin/env node
// Runs the dashboard as a macOS background service (a launchd agent), so it starts when you log
// in, restarts if it stops, and does not depend on a terminal or an editor staying open.
//
//   npm run service:install     build, then install and start the service
//   npm run service:restart     build again and restart it (after pulling or changing code)
//   npm run service:status      say whether it is running
//   npm run service:logs        show the end of its log
//   npm run service:uninstall   stop it and remove it
//
// PORT, HOST, REPO_ROOT, DATA_DIR, AUTO_MIRROR and FOLDER_PICKER set when installing are kept.

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LABEL = 'com.agent-dashboard';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const plist = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const dataDir = process.env.DATA_DIR ?? path.join(os.homedir(), '.agent-workspace');
const logFile = path.join(dataDir, 'logs', 'server.log');
const port = process.env.PORT ?? '4848';
const domain = `gui/${process.getuid?.() ?? os.userInfo().uid}`;
const KEPT = ['PORT', 'HOST', 'REPO_ROOT', 'DATA_DIR', 'AUTO_MIRROR', 'FOLDER_PICKER'];

const say = (line) => console.log(`[agent-dashboard] ${line}`);
const fail = (line) => {
	console.error(`[agent-dashboard] ${line}`);
	process.exit(1);
};
const launchctl = (...args) => spawnSync('launchctl', args, { encoding: 'utf8' });
const xml = (value) =>
	String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The PATH your login shell sets up. Agents run commands (git, gh, npm, python) and Claude Code
 * starts its tools from it, and launchd on its own offers only the system folders.
 */
function loginPath() {
	const shell = process.env.SHELL || '/bin/zsh';
	const found = spawnSync(shell, ['-lic', 'printf "%s" "$PATH"'], { encoding: 'utf8' });
	const seen = new Set();
	const parts = [
		path.dirname(process.execPath),
		...(found.stdout || '').split(':'),
		'/usr/bin',
		'/bin',
		'/usr/sbin',
		'/sbin',
	];
	return parts.filter((part) => part && !seen.has(part) && seen.add(part)).join(':');
}

async function healthy(seconds = 30) {
	for (let i = 0; i < seconds * 2; i += 1) {
		try {
			const res = await fetch(`http://127.0.0.1:${port}/api/health`);
			if (res.ok) return true;
		} catch {
			// Not up yet.
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	return false;
}

function build() {
	say('Building the page…');
	execFileSync(
		process.execPath,
		[path.join(project, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'],
		{
			cwd: project,
			stdio: ['ignore', 'ignore', 'inherit'],
		}
	);
}

async function install() {
	if (process.platform !== 'darwin')
		fail('The background service is for macOS only. Use `npm start` elsewhere.');
	const tsx = path.join(project, 'node_modules', 'tsx', 'dist', 'cli.mjs');
	if (!fs.existsSync(tsx)) fail('Run `npm install` first.');
	build();
	fs.mkdirSync(path.dirname(logFile), { recursive: true, mode: 0o700 });
	fs.mkdirSync(path.dirname(plist), { recursive: true });

	const env = { NODE_ENV: 'production', PATH: loginPath(), HOME: os.homedir() };
	for (const name of KEPT) if (process.env[name]) env[name] = process.env[name];
	const entries = Object.entries(env)
		.map(([key, value]) => `\t\t<key>${xml(key)}</key>\n\t\t<string>${xml(value)}</string>`)
		.join('\n');
	fs.writeFileSync(
		plist,
		`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${LABEL}</string>
	<key>ProgramArguments</key>
	<array>
		<string>${xml(process.execPath)}</string>
		<string>${xml(tsx)}</string>
		<string>server/index.ts</string>
	</array>
	<key>WorkingDirectory</key>
	<string>${xml(project)}</string>
	<key>EnvironmentVariables</key>
	<dict>
${entries}
	</dict>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>ThrottleInterval</key>
	<integer>10</integer>
	<key>ProcessType</key>
	<string>Interactive</string>
	<key>StandardOutPath</key>
	<string>${xml(logFile)}</string>
	<key>StandardErrorPath</key>
	<string>${xml(logFile)}</string>
</dict>
</plist>
`,
		{ mode: 0o644 }
	);

	// Replace any earlier copy of the service before starting this one.
	launchctl('bootout', `${domain}/${LABEL}`);
	const started = launchctl('bootstrap', domain, plist);
	if (started.status !== 0) fail(`launchd refused the service: ${started.stderr.trim()}`);
	launchctl('enable', `${domain}/${LABEL}`);
	if (!(await healthy()))
		fail(
			`The service started but the dashboard did not answer. See ${logFile} (npm run service:logs).`
		);
	say(`Running at http://127.0.0.1:${port}. It starts when you log in and restarts if it stops.`);
	say(`Log: ${logFile}`);
}

async function restart() {
	if (!fs.existsSync(plist)) fail('The service is not installed. Run `npm run service:install`.');
	build();
	const done = launchctl('kickstart', '-k', `${domain}/${LABEL}`);
	if (done.status !== 0) fail(`launchd could not restart it: ${done.stderr.trim()}`);
	if (!(await healthy())) fail(`The dashboard did not come back. See ${logFile}.`);
	say(`Restarted, running at http://127.0.0.1:${port}.`);
}

async function status() {
	const loaded = launchctl('print', `${domain}/${LABEL}`);
	if (loaded.status !== 0) return say('Not installed.');
	const pid = /\bpid = (\d+)/.exec(loaded.stdout)?.[1];
	const up = await healthy(1);
	say(
		`Installed${pid ? `, process ${pid}` : ', not running'}; dashboard ${up ? `answering at http://127.0.0.1:${port}` : 'not answering'}.`
	);
}

function logs() {
	if (!fs.existsSync(logFile)) return say('No log yet.');
	const lines = fs.readFileSync(logFile, 'utf8').trimEnd().split('\n');
	console.log(lines.slice(-40).join('\n'));
}

function uninstall() {
	launchctl('bootout', `${domain}/${LABEL}`);
	if (fs.existsSync(plist)) fs.rmSync(plist);
	say('Stopped and removed. Your chats are untouched; start it by hand with `npm start`.');
}

const commands = { install, restart, status, logs, uninstall };
const run = commands[process.argv[2]];
if (!run) fail(`Use one of: ${Object.keys(commands).join(', ')}`);
await run();
