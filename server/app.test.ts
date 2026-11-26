import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FILE_ROUTE } from '@shared/types';
import { allowedRoots, createApp, resolveLocalFile, workspaceConfig, type AppDeps } from './app';
import { loadConfig } from './config';
import { makeManager, makeSession } from './test_helpers';

async function makeDeps(repoRoot: string, initial = [makeSession()]): Promise<AppDeps> {
	const { manager, info } = await makeManager({ initial });
	const config = loadConfig({ REPO_ROOT: repoRoot, DATA_DIR: repoRoot } as NodeJS.ProcessEnv);
	return { config, manager, providerInfos: () => [info] };
}

describe('file route', () => {
	let repoRoot: string;
	let deps: AppDeps;

	beforeAll(async () => {
		repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aw-repo-'));
		await fs.mkdir(path.join(repoRoot, 'out', 'sub dir'), { recursive: true });
		await fs.writeFile(path.join(repoRoot, 'out', 'log.txt'), 'all green');
		await fs.writeFile(path.join(repoRoot, 'out', 'preview.html'), '<p>hi</p>');
		await fs.writeFile(path.join(repoRoot, 'out', 'sub dir', 'shot.png'), Buffer.from([1, 2, 3]));
		deps = await makeDeps(repoRoot);
	});

	afterAll(() => fs.rm(repoRoot, { recursive: true, force: true }));

	const get = (file: string) => createApp(deps).request(`${FILE_ROUTE}${file}`);

	it('serves text as text, never letting the browser guess the type', async () => {
		const res = await get(path.join(repoRoot, 'out', 'log.txt'));
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
		expect(res.headers.get('cache-control')).toBe('no-cache');
		expect(await res.text()).toBe('all green');
	});

	it('serves a page in its own origin so its scripts cannot reach the workspace', async () => {
		const res = await get(path.join(repoRoot, 'out', 'preview.html'));
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
		expect(res.headers.get('content-security-policy')).toBe('sandbox allow-scripts allow-popups');
	});

	it('serves binaries by extension and decodes an encoded path', async () => {
		const res = await get(`${repoRoot}/out/sub%20dir/shot.png`);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/png');
		expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from([1, 2, 3]));
		expect(res.headers.get('content-security-policy')).toBeNull();
	});

	it('refuses what is missing, a folder, a file outside the roots, or a malformed path', async () => {
		expect((await get(path.join(repoRoot, 'out', 'nope.txt'))).status).toBe(404);
		expect((await get(path.join(repoRoot, 'out'))).status).toBe(404);
		expect((await get(process.execPath)).status).toBe(404);
		expect((await get('/%E0%A4%A')).status).toBe(400);
	});
});

describe('your picture', () => {
	it('is offered to the page only when the data folder holds one, and served from there', async () => {
		const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aw-avatar-'));
		const deps = await makeDeps(dataDir, []);
		const app = createApp(deps);
		expect((await workspaceConfig(deps)).avatar).toBeUndefined();
		expect((await app.request('/api/avatar')).status).toBe(404);

		await fs.writeFile(path.join(dataDir, 'avatar.png'), Buffer.from([137, 80, 78, 71]));
		const address = (await workspaceConfig(deps)).avatar;
		expect(address).toMatch(/^\/api\/avatar\?v=\d+$/);
		const res = await app.request(address!);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/png');
		expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from([137, 80, 78, 71]));
		await fs.rm(dataDir, { recursive: true, force: true });
	});
});

describe('your own topic logos', () => {
	it('offers the pictures in the logos folder that are named after a topic, and serves them', async () => {
		const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aw-logos-'));
		const deps = await makeDeps(dataDir, []);
		const app = createApp(deps);
		expect((await workspaceConfig(deps)).logos).toBeUndefined();

		await fs.mkdir(path.join(dataDir, 'logos'));
		await fs.writeFile(path.join(dataDir, 'logos', 'rcs.png'), Buffer.from([137, 80, 78, 71]));
		// Not a topic, and not a plain picture: neither is picked up.
		await fs.writeFile(path.join(dataDir, 'logos', 'not-a-topic.png'), 'x');
		await fs.writeFile(path.join(dataDir, 'logos', 'pricing.svg'), '<svg/>');
		const logos = (await workspaceConfig(deps)).logos!;
		expect(Object.keys(logos)).toEqual(['rcs']);
		const res = await app.request(logos.rcs!);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/png');
		expect((await app.request('/api/logos/pricing')).status).toBe(404);
		expect((await app.request('/api/logos/..%2Fsessions')).status).toBe(404);
		await fs.rm(dataDir, { recursive: true, force: true });
	});
});

describe('artifact library route', () => {
	it('answers with the library, and with nothing when the server has none', async () => {
		const deps = await makeDeps(os.tmpdir(), []);
		expect(await (await createApp(deps).request('/api/artifacts')).json()).toEqual([]);
		const item = { id: 'page:1', kind: 'page' as const, title: 'Map', updatedAt: 1 };
		const withLibrary = createApp({
			...deps,
			artifacts: { list: async () => [item] } as unknown as AppDeps['artifacts'],
		});
		expect(await (await withLibrary.request('/api/artifacts')).json()).toEqual([item]);
	});
});

describe('new agent and rename routes', () => {
	const json = { 'content-type': 'application/json' };

	it('answers with the folder picked on this machine, or says the chooser is unavailable', async () => {
		const deps = await makeDeps(os.tmpdir());
		const picked: string[] = [];
		const withPicker = createApp({
			...deps,
			config: { ...deps.config, folderPicker: true },
			pickFolder: async (startDir) => {
				picked.push(startDir);
				return { path: '/Users/me/project' };
			},
		});
		const res = await withPicker.request('/api/pick-folder', { method: 'POST', headers: json });
		expect(await res.json()).toEqual({ path: '/Users/me/project' });
		expect(picked).toEqual([os.tmpdir()]);

		const without = createApp({ ...deps, config: { ...deps.config, folderPicker: false } });
		expect(
			(await without.request('/api/pick-folder', { method: 'POST', headers: json })).status
		).toBe(400);
	});

	it('creates a card from a folder alone and renames it', async () => {
		const deps = await makeDeps(os.tmpdir(), []);
		const app = createApp(deps);
		const created = await app.request('/api/sessions', {
			method: 'POST',
			headers: json,
			body: JSON.stringify({ path: os.tmpdir() }),
		});
		expect(created.status).toBe(201);
		const card = (await created.json()) as { id: string; state: string };
		expect(card.state).toBe('Done');
		const renamed = await app.request(`/api/sessions/${card.id}/title`, {
			method: 'POST',
			headers: json,
			body: JSON.stringify({ title: 'Pricing review' }),
		});
		expect(await renamed.json()).toMatchObject({ title: 'Pricing review', icon: 'pricing' });
		const icon = (pick: string | null) =>
			app.request(`/api/sessions/${card.id}/icon`, {
				method: 'POST',
				headers: json,
				body: JSON.stringify({ icon: pick }),
			});
		expect(await (await icon('launch')).json()).toMatchObject({ icon: 'launch', iconChosen: true });
		expect((await icon('not-an-icon')).status).toBe(400);
		expect(await (await icon(null)).json()).toMatchObject({ icon: 'pricing' });
	});
});

describe('resolveLocalFile', () => {
	let root: string;
	let outside: string;

	beforeAll(async () => {
		root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aw-root-')));
		outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aw-outside-')));
		await fs.writeFile(path.join(root, 'in.txt'), 'in');
		await fs.writeFile(path.join(outside, 'out.txt'), 'out');
		await fs.symlink(path.join(outside, 'out.txt'), path.join(root, 'link.txt'));
	});

	afterAll(async () => {
		await fs.rm(root, { recursive: true, force: true });
		await fs.rm(outside, { recursive: true, force: true });
	});

	it('keeps to the roots through dot segments and symlinks', async () => {
		expect(await resolveLocalFile(path.join(root, 'in.txt'), [root])).toBe(
			path.join(root, 'in.txt')
		);
		expect(await resolveLocalFile(`${root}/sub/../in.txt`, [root])).toBe(path.join(root, 'in.txt'));
		expect(
			await resolveLocalFile(`${root}/../${path.basename(outside)}/out.txt`, [root])
		).toBeUndefined();
		expect(await resolveLocalFile(path.join(root, 'link.txt'), [root])).toBeUndefined();
		expect(await resolveLocalFile(path.join(root, 'link.txt'), [root, outside])).toBe(
			path.join(outside, 'out.txt')
		);
		expect(await resolveLocalFile('relative.txt', [root])).toBeUndefined();
		// Hidden files and folders are never served, whichever root would allow them.
		await fs.mkdir(path.join(root, '.git'), { recursive: true });
		await fs.writeFile(path.join(root, '.env'), 'TOKEN=secret');
		await fs.writeFile(path.join(root, '.git', 'config'), 'x');
		expect(await resolveLocalFile(path.join(root, '.env'), [root])).toBeUndefined();
		expect(await resolveLocalFile(path.join(root, '.git', 'config'), [root])).toBeUndefined();
		expect(
			await resolveLocalFile(path.join(root, '.git', 'config'), [root, path.join(root, '.git')])
		).toBeUndefined();
		expect(await resolveLocalFile(root, [root])).toBeUndefined();
	});
});

describe('allowedRoots', () => {
	it('covers the repos, the temp folders and every session folder', async () => {
		const sessionDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aw-sess-')));
		const repoRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aw-repo-')));
		const deps = await makeDeps(repoRoot, [makeSession({ path: sessionDir })]);
		const roots = await allowedRoots(deps);
		expect(roots).toEqual(
			expect.arrayContaining([repoRoot, sessionDir, await fs.realpath(os.tmpdir())])
		);
		await fs.rm(sessionDir, { recursive: true, force: true });
		await fs.rm(repoRoot, { recursive: true, force: true });
	});
});
