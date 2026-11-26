import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ArtifactIndex, filesMentioned, scanChat, titleFromFile } from './artifacts';

const record = (minute: number, cwd: string, content: unknown, type = 'assistant') =>
	JSON.stringify({
		type,
		timestamp: new Date(Date.UTC(2026, 0, 5, 9, minute)).toISOString(),
		cwd,
		message: { role: type, content },
	});
const use = (id: string, name: string, input: Record<string, unknown>) => [
	{ type: 'tool_use', id, name, input },
];
const result = (id: string, content: string, isError = false) => [
	{ type: 'tool_result', tool_use_id: id, content, is_error: isError },
];
const URL_A = 'https://claude.ai/artifact/AaaPage01';

describe('reading artifacts out of a saved chat', () => {
	it('finds the files a reply points to, and nothing that is not a deliverable', () => {
		const found = filesMentioned(
			'See [the deck](out/Q3%20plan.pptx), [site](https://example.com/a.pdf), `/work/shop/rates.csv`, ' +
				'/work/shop/notes.md and the report at /work/shop/report.pdf.',
			'/work/shop'
		);
		expect(found.sort()).toEqual([
			'/work/shop/out/Q3 plan.pptx',
			'/work/shop/rates.csv',
			'/work/shop/report.pdf',
		]);
	});

	it('keeps successful publishes, deletes and written files; skips refusals and asset uploads', () => {
		const chat = [
			record(
				1,
				'/work',
				use('t1', 'Artifact', { file_path: '/work/map.html', title: 'Billing map' })
			),
			record(2, '/work', result('t1', `Published /work/map.html at ${URL_A} (Version 1)`), 'user'),
			record(3, '/work', use('t2', 'Artifact', { file_path: '/work/map.html', url: URL_A })),
			record(4, '/work', result('t2', 'Publish refused — nothing was merged or published'), 'user'),
			record(
				5,
				'/work',
				use('t3', 'Artifact', { file_path: '/work/d.json', url: URL_A, asset: true })
			),
			record(6, '/work', result('t3', 'Asset uploaded: "d.json"'), 'user'),
			record(7, '/work', use('t4', 'Write', { file_path: '/work/proto/index.html', content: 'x' })),
			record(
				8,
				'/work',
				use('t5', 'Artifact', { action: 'delete', url: 'https://claude.ai/artifact/Old02' })
			),
			'not json at all "Artifact"',
		].join('\n');
		const found = scanChat(chat, 'chat-1');
		expect(found.pages).toEqual([
			{
				artifactId: 'AaaPage01',
				url: URL_A,
				title: 'Billing map',
				source: '/work/map.html',
				ts: Date.UTC(2026, 0, 5, 9, 1),
			},
		]);
		expect(found.deleted).toEqual([{ artifactId: 'Old02', ts: Date.UTC(2026, 0, 5, 9, 8) }]);
		expect(found.files.map((file) => file.file)).toEqual(['/work/proto/index.html']);
	});

	it('names a file from itself, or from its folder when it is only called index', () => {
		expect(titleFromFile('/work/rcs-signups_dashboard.pdf')).toBe('Rcs signups dashboard');
		expect(titleFromFile('/work/checkout-demo/index.html')).toBe('Checkout demo');
	});
});

describe('the artifact library', () => {
	let root: string;
	beforeEach(async () => {
		root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aw-library-')));
	});
	afterEach(() => fs.rm(root, { recursive: true, force: true }));

	const saveChat = async (name: string, lines: string[]) => {
		const dir = path.join(root, 'claude', 'projects', '-work');
		await fs.mkdir(dir, { recursive: true });
		await fs.writeFile(path.join(dir, `${name}.jsonl`), `${lines.join('\n')}\n`);
	};

	it('lists pages and files newest first, drops deleted pages, and keeps a copy of a page', async () => {
		const work = path.join(root, 'work');
		await fs.mkdir(path.join(work, 'node_modules', 'x'), { recursive: true });
		await fs.writeFile(path.join(work, 'map.html'), '<title>Billing &amp; usage map</title>');
		await fs.writeFile(path.join(work, 'rates.csv'), 'a,b\n1,2\n');
		await fs.writeFile(path.join(work, 'node_modules', 'x', 'demo.html'), '<title>Dep</title>');
		await saveChat('chat-1', [
			record(1, work, use('t1', 'Artifact', { file_path: path.join(work, 'map.html') })),
			record(2, work, result('t1', `Published ${work}/map.html at ${URL_A} (Version 1)`), 'user'),
			record(3, work, [
				{ type: 'text', text: 'Rates are in [rates.csv](rates.csv), not missing.pdf.' },
			]),
			record(
				3,
				work,
				use('w1', 'Write', { file_path: path.join(work, 'node_modules/x/demo.html') })
			),
			record(4, work, use('t2', 'Artifact', { file_path: path.join(work, 'old.html') })),
			record(
				5,
				work,
				result('t2', 'Published at https://claude.ai/artifact/Old02 (Version 1)'),
				'user'
			),
			record(
				6,
				work,
				use('t3', 'Artifact', { action: 'delete', url: 'https://claude.ai/artifact/Old02' })
			),
		]);
		const keepDir = path.join(root, 'kept');
		const index = new ArtifactIndex({
			projectsDir: path.join(root, 'claude', 'projects'),
			keepDir,
			chatTitles: async () => new Map([['chat-1', 'Pricing work']]),
		});
		const items = await index.list();
		expect(items.map((item) => [item.kind, item.title, Boolean(item.url)])).toEqual([
			['sheet', 'Rates', false],
			['page', 'Billing & usage map', true],
		]);
		expect(items[1]).toMatchObject({
			id: 'page:AaaPage01',
			url: URL_A,
			file: path.join(work, 'map.html'),
			chatId: 'chat-1',
			chatTitle: 'Pricing work',
		});

		// The source is cleared away, as a temporary folder would be: the kept copy takes over.
		await fs.rm(path.join(work, 'map.html'));
		const later = (await index.list()).find((item) => item.kind === 'page')!;
		expect(later.file).toBe(path.join(keepDir, 'AaaPage01.html'));
		expect(later.title).toBe('Billing & usage map');
		expect((await fs.stat(later.file!)).mode & 0o777).toBe(0o600);
	});

	it('leaves out files the file route would not serve, and is empty without any chats', async () => {
		expect(await new ArtifactIndex({ projectsDir: path.join(root, 'nope') }).list()).toEqual([]);
		await fs.writeFile(path.join(root, 'secret.pdf'), 'x');
		await saveChat('chat-2', [
			record(1, root, [{ type: 'text', text: `Saved to ${root}/secret.pdf` }]),
		]);
		const index = new ArtifactIndex({
			projectsDir: path.join(root, 'claude', 'projects'),
			canServe: async () => false,
		});
		expect(await index.list()).toEqual([]);
	});
});
