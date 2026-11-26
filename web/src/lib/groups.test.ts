import { makeSession } from '../tests/fixtures';
import { countByFilter, filterOf, isFresh, shownState } from './groups';
import { orderSessions } from './order';

const busyElsewhere = {
	sessionId: 'x',
	lastModified: 0,
	active: true,
	messageCount: 1,
	open: { pid: 1, status: 'busy' as const, client: 'VS Code' },
};

describe('grouping cards', () => {
	const running = makeSession({ id: 'run', state: 'Running' });
	const waiting = makeSession({ id: 'ask', state: 'Needs input' });
	const done = makeSession({ id: 'done', state: 'Done' });
	const failed = makeSession({ id: 'err', state: 'Error' });
	const fresh = makeSession({ id: 'new', state: 'Done', turns: 0, transcript: [] });
	const mirrored = makeSession({ id: 'vs', state: 'Done', external: busyElsewhere });

	it('counts every open agent under exactly one chip', () => {
		const all = [running, waiting, done, failed, fresh, mirrored];
		expect(countByFilter(all)).toEqual({ all: 6, reply: 1, running: 2, done: 3 });
		expect(filterOf(mirrored)).toBe('running');
		expect(shownState(mirrored)).toBe('Running');
		expect(isFresh(fresh)).toBe(true);
		expect(isFresh(done)).toBe(false);
	});

	it('puts pinned cards first, in the order they were arranged', () => {
		const a = makeSession({ id: 'a', createdAt: 1 });
		const b = makeSession({ id: 'b', createdAt: 2 });
		const c = makeSession({ id: 'c', createdAt: 3 });
		expect(orderSessions([a, b, c], ['a', 'b', 'c'], ['c']).map((s) => s.id)).toEqual([
			'c',
			'a',
			'b',
		]);
		// A new card nobody has placed still comes before the placed ones, after the pinned.
		expect(orderSessions([a, b, c], ['a'], ['a']).map((s) => s.id)).toEqual(['a', 'c', 'b']);
	});
});
