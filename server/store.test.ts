import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionStore } from './store';
import { makeSession } from './test_helpers';

describe('SessionStore', () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(path.join(os.tmpdir(), 'agent-workspace-store-'));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it('round-trips sessions through disk', () => {
		const file = path.join(dir, 'nested', 'sessions.json');
		const store = new SessionStore(file, 0);
		const session = makeSession({ transcript: [{ id: 'e1', ts: 1, kind: 'user', text: 'hi' }] });
		store.save([session]);
		store.flush();
		expect(new SessionStore(file).load()).toEqual([session]);
	});

	it('coalesces rapid saves and keeps the last one', () => {
		const file = path.join(dir, 'sessions.json');
		const store = new SessionStore(file, 0);
		store.save([makeSession({ title: 'first' })]);
		store.save([makeSession({ title: 'second' })]);
		store.flush();
		expect(new SessionStore(file).load().map((s) => s.title)).toEqual(['second']);
	});

	it.each(
		Object.entries({
			'missing file': undefined,
			'blank file': '',
			'file without sessions': '{"version":1}',
		})
	)('returns an empty list for a %s', (_name, content) => {
		const file = path.join(dir, 'sessions.json');
		if (content !== undefined) writeFileSync(file, content);
		expect(new SessionStore(file).load()).toEqual([]);
	});
});
