import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import {
	FILE_ROUTE,
	type AnswerInput,
	type BootstrapResponse,
	type CreateSessionInput,
	type PermissionMode,
	type PromptFile,
	type ProviderInfo,
	type WorkspaceConfig,
} from '@shared/types';
import { isTopic } from '@shared/topics';
import type { ArtifactIndex } from './artifacts';
import type { ServerConfig } from './config';
import { pickFolder, type PickedFolder } from './folder_picker';
import { makeOriginPolicy } from './security';
import { HttpError, type SessionManager } from './session_manager';

export interface AppDeps {
	config: ServerConfig;
	manager: SessionManager;
	providerInfos: () => ProviderInfo[];
	/** Replaces the real folder chooser in tests. */
	pickFolder?: (startDir: string) => Promise<PickedFolder>;
	/** The library of what agents made, read from saved chats. Absent in a hermetic demo. */
	artifacts?: ArtifactIndex;
}

const MIME: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.ico': 'image/x-icon',
	'.json': 'application/json; charset=utf-8',
	'.woff2': 'font/woff2',
	'.map': 'application/json',
};

// Anything not listed is shown as text, which is what code, logs and Markdown want.
const FILE_MIME: Record<string, string> = {
	...MIME,
	'.htm': 'text/html; charset=utf-8',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.pdf': 'application/pdf',
	'.csv': 'text/csv; charset=utf-8',
	'.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	'.xls': 'application/vnd.ms-excel',
	'.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
	'.mp4': 'video/mp4',
};

export const attachmentsDir = (config: ServerConfig) => path.join(config.dataDir, 'attachments');
/** Copies of published pages' sources, kept so their previews outlive temporary folders. */
export const keptPagesDir = (config: ServerConfig) => path.join(config.dataDir, 'artifacts');

/** Folders the browser may open files from: the repos, every session's folder, and where agents write temp files. */
export async function allowedRoots(deps: AppDeps): Promise<string[]> {
	const roots = new Set([
		deps.config.repoRoot,
		// Pictures sent with prompts, so the transcript can show them.
		attachmentsDir(deps.config),
		keptPagesDir(deps.config),
		os.tmpdir(),
		'/tmp',
		...deps.manager.list().map((s) => s.path),
	]);
	const real = await Promise.all([...roots].map((r) => fs.realpath(r).catch(() => undefined)));
	return real.filter((r): r is string => r !== undefined);
}

/** The real file behind an absolute path, provided it sits inside one of the roots. */
export async function resolveLocalFile(
	requested: string,
	roots: string[]
): Promise<string | undefined> {
	if (!path.isAbsolute(requested)) return undefined;
	const real = await fs.realpath(path.normalize(requested)).catch(() => undefined);
	if (!real) return undefined;
	const containing = roots.filter((root) => real.startsWith(root + path.sep));
	if (!containing.length) return undefined;
	// Hidden files and folders hold credentials and tool state (.env, .git, .ssh, .claude).
	// An agent reply has no reason to link to one, so none is served.
	const hidden = containing.some((root) =>
		path
			.relative(root, real)
			.split(path.sep)
			.some((segment) => segment.startsWith('.'))
	);
	if (hidden) return undefined;
	const stat = await fs.stat(real).catch(() => undefined);
	return stat?.isFile() ? real : undefined;
}

export async function listProjects(repoRoot: string): Promise<string[]> {
	try {
		const entries = await fs.readdir(repoRoot, { withFileTypes: true });
		return entries
			.filter((e) => e.isDirectory() && !e.name.startsWith('.'))
			.map((e) => e.name)
			.sort((a, b) => a.localeCompare(b));
	} catch {
		return [];
	}
}

const AVATAR_TYPES: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.gif': 'image/gif',
};

/** Your picture for the chat: `avatar.png` (or .jpg, .webp, .gif) in the data folder, if there is one. */
export async function findAvatar(
	config: ServerConfig
): Promise<{ file: string; type: string; version: number } | undefined> {
	for (const [extension, type] of Object.entries(AVATAR_TYPES)) {
		const file = path.join(config.dataDir, `avatar${extension}`);
		const stat = await fs.stat(file).catch(() => undefined);
		if (stat?.isFile() && stat.size > 0 && stat.size <= 2 * 1024 * 1024)
			return { file, type, version: Math.round(stat.mtimeMs) };
	}
	return undefined;
}

const LOGO_TYPES: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
};

/**
 * Your own pictures for topic icons: files in the data folder's `logos` folder named after a
 * topic id, such as `rcs.png`. Only known topics and plain picture files are picked up.
 */
export async function findLogos(
	config: ServerConfig
): Promise<Map<string, { file: string; type: string; version: number }>> {
	const dir = path.join(config.dataDir, 'logos');
	const found = new Map<string, { file: string; type: string; version: number }>();
	for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
		const extension = path.extname(name).toLowerCase();
		const topic = path.basename(name, path.extname(name));
		const type = LOGO_TYPES[extension];
		if (!type || !isTopic(topic) || found.has(topic)) continue;
		const file = path.join(dir, name);
		const stat = await fs.stat(file).catch(() => undefined);
		if (stat?.isFile() && stat.size > 0 && stat.size <= 1024 * 1024)
			found.set(topic, { file, type, version: Math.round(stat.mtimeMs) });
	}
	return found;
}

export async function workspaceConfig(deps: AppDeps): Promise<WorkspaceConfig> {
	const avatar = await findAvatar(deps.config);
	const logos = await findLogos(deps.config);
	return {
		...(logos.size
			? {
					logos: Object.fromEntries(
						[...logos].map(([topic, logo]) => [topic, `/api/logos/${topic}?v=${logo.version}`])
					),
				}
			: {}),
		// The version changes when the picture does, so the browser never shows a stale one.
		...(avatar ? { avatar: `/api/avatar?v=${avatar.version}` } : {}),
		repoRoot: deps.config.repoRoot,
		projects: await listProjects(deps.config.repoRoot),
		anyLive: deps.providerInfos().some((p) => p.mode === 'live'),
		folderPicker: deps.config.folderPicker,
		defaultPermissionMode: deps.manager.defaultPermissionMode,
	};
}

export function createApp(deps: AppDeps): Hono {
	const { manager } = deps;
	const app = new Hono();

	app.onError((err, c) => {
		if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
		console.error(err);
		return c.json({ error: err instanceof Error ? err.message : 'Internal error' }, 500);
	});

	// No login protects this server, so requests that come from another site are refused
	// before any route runs. See security.ts for what each check stops.
	const policy = makeOriginPolicy(deps.config);
	app.use('*', async (c, next) => {
		const url = new URL(c.req.url);
		const isApi = url.pathname.startsWith('/api/');
		const refusal = policy.refuse({
			method: isApi ? c.req.method : 'GET',
			host: c.req.header('host') ?? url.host,
			// The page itself may be opened from a link on another site; only the API is closed to them.
			origin: isApi ? c.req.header('origin') : undefined,
			fetchSite: isApi ? c.req.header('sec-fetch-site') : undefined,
			contentType: c.req.header('content-type'),
		});
		if (refusal) return c.json({ error: refusal }, 403);
		return next();
	});

	app.get('/api/health', (c) => c.json({ ok: true }));

	const bootstrap = async (): Promise<BootstrapResponse> => {
		const config = await workspaceConfig(deps);
		manager.lastConfig = config;
		return { providers: deps.providerInfos(), sessions: manager.list(), config };
	};

	app.get('/api/bootstrap', async (c) => c.json(await bootstrap()));

	app.get('/api/artifacts', async (c) => c.json((await deps.artifacts?.list()) ?? []));

	app.get('/api/logos/:topic', async (c) => {
		const logo = (await findLogos(deps.config)).get(c.req.param('topic'));
		if (!logo) return c.json({ error: 'Not found' }, 404);
		return c.body(await fs.readFile(logo.file), 200, {
			'Content-Type': logo.type,
			'Cache-Control': 'private, max-age=31536000, immutable',
			'X-Content-Type-Options': 'nosniff',
		});
	});

	app.get('/api/avatar', async (c) => {
		const avatar = await findAvatar(deps.config);
		if (!avatar) return c.json({ error: 'Not found' }, 404);
		return c.body(await fs.readFile(avatar.file), 200, {
			'Content-Type': avatar.type,
			'Cache-Control': 'private, max-age=31536000, immutable',
			'X-Content-Type-Options': 'nosniff',
		});
	});

	// One switch for every card, and for the cards that appear later.
	app.post('/api/permissions', async (c) => {
		const { mode } = (await c.req.json()) as { mode: PermissionMode };
		manager.setPermissionModeForAll(mode);
		return c.json(await bootstrap());
	});

	app.post('/api/sessions', async (c) => {
		const input = (await c.req.json()) as CreateSessionInput;
		return c.json(await manager.create(input), 201);
	});

	app.post('/api/sessions/:id/prompt', async (c) => {
		const { text, files } = (await c.req.json()) as { text: string; files?: PromptFile[] };
		return c.json(await manager.prompt(c.req.param('id'), text, files ?? []));
	});

	app.post('/api/sessions/:id/title', async (c) => {
		const { title } = (await c.req.json()) as { title: string };
		return c.json(manager.rename(c.req.param('id'), title));
	});

	app.post('/api/sessions/:id/icon', async (c) => {
		const { icon } = (await c.req.json()) as { icon: string | null };
		return c.json(manager.setIcon(c.req.param('id'), icon ?? null));
	});

	// Opens this machine's folder chooser and answers with the folder picked.
	app.post('/api/pick-folder', async (c) => {
		if (!deps.config.folderPicker)
			throw new HttpError(400, 'The folder chooser is not available on this machine');
		return c.json(await (deps.pickFolder ?? pickFolder)(deps.config.repoRoot));
	});

	app.post('/api/sessions/:id/stop', async (c) => c.json(await manager.stop(c.req.param('id'))));
	app.post('/api/sessions/:id/resume', (c) => c.json(manager.resume(c.req.param('id'))));
	app.post('/api/sessions/:id/close', (c) => c.json(manager.close(c.req.param('id'))));
	app.post('/api/sessions/:id/reopen', (c) => c.json(manager.reopen(c.req.param('id'))));

	app.post('/api/sessions/:id/model', async (c) => {
		const { model } = (await c.req.json()) as { model: string };
		return c.json(manager.setNextModel(c.req.param('id'), model));
	});

	app.post('/api/sessions/:id/permissions', async (c) => {
		const { mode } = (await c.req.json()) as { mode: PermissionMode };
		return c.json(manager.setPermissionMode(c.req.param('id'), mode));
	});

	app.post('/api/sessions/:id/answer', async (c) => {
		const input = (await c.req.json()) as AnswerInput;
		return c.json(manager.answer(c.req.param('id'), input));
	});

	app.delete('/api/sessions/:id', async (c) => {
		await manager.remove(c.req.param('id'));
		return c.body(null, 204);
	});

	// Files that agent replies link to, served from this machine so the browser can open them.
	app.get(`${FILE_ROUTE}/*`, async (c) => {
		let requested: string;
		try {
			requested = decodeURIComponent(new URL(c.req.url).pathname.slice(FILE_ROUTE.length));
		} catch {
			return c.json({ error: 'Bad path' }, 400);
		}
		const file = await resolveLocalFile(requested, await allowedRoots(deps));
		if (!file) return c.json({ error: 'Not found' }, 404);
		const type = FILE_MIME[path.extname(file).toLowerCase()] ?? 'text/plain; charset=utf-8';
		const headers: Record<string, string> = {
			'Content-Type': type,
			'Cache-Control': 'no-cache',
			'X-Content-Type-Options': 'nosniff',
		};
		// A served page gets its own origin, so a script inside it cannot reach the workspace API.
		if (type.startsWith('text/html')) {
			headers['Content-Security-Policy'] = 'sandbox allow-scripts allow-popups';
		}
		return c.body(await fs.readFile(file), 200, headers);
	});

	app.get('/api/*', (c) => c.json({ error: 'Not found' }, 404));

	// Built web client, with the SPA fallback. In development Vite serves it instead.
	app.get('/*', async (c) => {
		const root = deps.config.staticDir;
		const requested = path.normalize(decodeURIComponent(new URL(c.req.url).pathname));
		const candidate = path.join(root, requested);
		const inRoot = candidate.startsWith(root + path.sep) || candidate === root;
		let file = inRoot ? candidate : path.join(root, 'index.html');
		let stat = await fs.stat(file).catch(() => undefined);
		if (!stat?.isFile()) {
			file = path.join(root, 'index.html');
			stat = await fs.stat(file).catch(() => undefined);
			if (!stat?.isFile())
				return c.text('Web client is not built. Run `npm run build` or use `npm run dev`.', 404);
		}
		const body = await fs.readFile(file);
		const type = MIME[path.extname(file)] ?? 'application/octet-stream';
		const cache = file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable';
		return c.body(body, 200, { 'Content-Type': type, 'Cache-Control': cache });
	});

	return app;
}
