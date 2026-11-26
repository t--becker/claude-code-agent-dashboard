import { makeSession } from '../tests/fixtures';
import { moveCard, orderSessions } from './order';

const card = (id: string, createdAt: number) => makeSession({ id, createdAt });

describe('card order', () => {
	it('keeps the arranged order and puts cards not yet placed first, newest on top', () => {
		const cards = [card('a', 1), card('b', 2), card('c', 3), card('d', 4)];
		expect(orderSessions(cards, []).map((s) => s.id)).toEqual(['d', 'c', 'b', 'a']);
		expect(orderSessions(cards, ['b', 'gone', 'a']).map((s) => s.id)).toEqual(['d', 'c', 'b', 'a']);
		expect(orderSessions(cards, ['a', 'd', 'c', 'b']).map((s) => s.id)).toEqual([
			'a',
			'd',
			'c',
			'b',
		]);
	});

	it('moves a card to where another sits, in either direction', () => {
		const ids = ['a', 'b', 'c', 'd'];
		expect(moveCard(ids, 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
		expect(moveCard(ids, 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
		expect(moveCard(ids, 'b', 'b')).toBe(ids);
		expect(moveCard(ids, 'x', 'b')).toBe(ids);
	});
});
