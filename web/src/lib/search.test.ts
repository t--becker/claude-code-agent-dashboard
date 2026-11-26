import { makeSession } from '../tests/fixtures';
import { markWords, searchSessions } from './search';

const chat = (
	id: string,
	title: string,
	updatedAt: number,
	lines: [kind: 'user' | 'assistant', text: string][],
	closed = false
) =>
	makeSession({
		id,
		title,
		updatedAt,
		closed,
		transcript: lines.map(([kind, text], n) => ({ id: `${id}-${n}`, ts: n, kind, text })),
	});

describe('searching chats', () => {
	const pricing = chat('a', 'ReadMe MCP pricing', 300, [
		['user', 'What does ReadMe charge for MCP calls?'],
		[
			'assistant',
			'The pricing page and the MCP FAQ give different answers about search and fetch.',
		],
	]);
	const tour = chat('b', 'RCS onboarding overview', 200, [
		['user', 'What is this project about?'],
		[
			'assistant',
			'The self-service flow has shipped. It tracks the RCS parity roadmap and billing data.',
		],
	]);
	const old = chat(
		'c',
		'France billing',
		100,
		[['assistant', 'Per-message billing for RCS in France.']],
		true
	);
	const all = [tour, old, pricing];

	it('finds chats by title or by any message, open or closed, title matches first', () => {
		expect(searchSessions(all, 'billing').map((hit) => hit.session.id)).toEqual(['c', 'b']);
		const closedHit = searchSessions(all, 'billing')[0]!;
		expect(closedHit.session.closed).toBe(true);
		expect(searchSessions(all, 'roadmap')[0]).toMatchObject({ where: 'agent', matches: 1 });
		expect(searchSessions(all, 'roadmap')[0]!.snippet).toContain('RCS parity roadmap');
		expect(searchSessions(all, 'project about')[0]).toMatchObject({ where: 'you' });
	});

	it('needs every word, ignores case, and returns nothing for an empty search', () => {
		expect(searchSessions(all, 'MCP faq').map((hit) => hit.session.id)).toEqual(['a']);
		expect(searchSessions(all, 'mcp france')).toEqual([]);
		expect(searchSessions(all, '   ')).toEqual([]);
		expect(searchSessions(all, 'rcs', 1)).toHaveLength(1);
	});

	it('marks the words it matched', () => {
		expect(markWords('The MCP FAQ page', 'mcp page')).toEqual([
			{ text: 'The ', hit: false },
			{ text: 'MCP', hit: true },
			{ text: ' FAQ ', hit: false },
			{ text: 'page', hit: true },
		]);
		// A match at the very start or end is still the one marked.
		expect(markWords('Metronome conversation', 'metronome')).toEqual([
			{ text: 'Metronome', hit: true },
			{ text: ' conversation', hit: false },
		]);
		expect(markWords('a.b', '.')).toEqual([
			{ text: 'a', hit: false },
			{ text: '.', hit: true },
			{ text: 'b', hit: false },
		]);
	});
});
