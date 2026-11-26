import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { WebSocketServer, WebSocket } from 'ws';
import type { ServerEvent } from '@shared/types';
import { attachmentsDir, createApp, workspaceConfig } from './app';
import { loadConfig } from './config';
import { EventBus } from './events';
import { getBranch } from './git';
import { NoExternalSource, SdkExternalSource } from './providers/claude_sessions';
import { buildProviders } from './providers/registry';
import { isExposed, makeOriginPolicy } from './security';
import { SessionManager } from './session_manager';
import { SettingsStore } from './settings';
import { SessionStore } from './store';

const log = (message: string) => console.log(`[agent-dashboard] ${message}`);

async function main() {
	const config = loadConfig();
	// Transcripts can hold anything an agent read, so the data folder is for this user only.
	fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
	fs.chmodSync(config.dataDir, 0o700);
	if (isExposed(config.host))
		log(
			`WARNING: HOST=${config.host} makes this server reachable from other machines. It has no login: anyone who can reach it can read your chats and run agents on this machine.`
		);

	const registry = await buildProviders(config, log);
	for (const info of registry.infos) {
		log(
			`${info.label}: ${info.mode}${info.reason ? ` (${info.reason})` : ''}, ${info.models.length} models from ${info.modelsSource}`
		);
	}

	const store = new SessionStore(path.join(config.dataDir, 'sessions.json'));
	const settings = new SettingsStore(path.join(config.dataDir, 'settings.json'));
	const bus = new EventBus();
	const manager = new SessionManager({
		store,
		bus,
		providers: registry.providers,
		providerInfos: () => registry.infos,
		getBranch,
		// Demo mode stays hermetic: it never reads the real ~/.claude chats.
		external: config.forceDemo ? new NoExternalSource() : new SdkExternalSource(),
		autoMirror: config.autoMirror,
		attachmentsDir: attachmentsDir(config),
		defaultPermissionMode: settings.load().defaultPermissionMode,
		saveDefaultPermissionMode: (mode) => settings.save({ defaultPermissionMode: mode }),
		log,
	});
	manager.init();
	manager.startMirroring();

	const deps = { config, manager, providerInfos: () => registry.infos };
	const app = createApp(deps);
	const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
		log(
			`listening on http://${info.address}:${info.port} (data: ${config.dataDir}, repos: ${config.repoRoot})`
		);
	}) as http.Server;

	// The socket sends every transcript, and browsers let any page open a WebSocket to
	// localhost, so the handshake gets the same checks as the API.
	const policy = makeOriginPolicy(config);
	const wss = new WebSocketServer({
		server,
		path: '/ws',
		verifyClient: ({ origin, req }: { origin?: string; req: http.IncomingMessage }) =>
			policy.refuse({
				method: 'GET',
				host: req.headers.host,
				origin: origin || undefined,
				fetchSite: String(req.headers['sec-fetch-site'] ?? '') || undefined,
			}) === undefined,
	});
	wss.on('connection', async (socket) => {
		const snapshot: ServerEvent = {
			type: 'snapshot',
			providers: registry.infos,
			sessions: manager.list(),
			config: await workspaceConfig(deps),
		};
		socket.send(JSON.stringify(snapshot));
	});
	bus.subscribe((event) => {
		const payload = JSON.stringify(event);
		for (const client of wss.clients) {
			if (client.readyState === WebSocket.OPEN) client.send(payload);
		}
	});

	const shutdown = () => {
		manager.stopMirroring();
		store.flush();
		process.exit(0);
	};
	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
