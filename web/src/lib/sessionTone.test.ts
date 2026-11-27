import { assignTones, TONE_COUNT } from './sessionTone';

const cards = (count: number) =>
	Array.from({ length: count }, (_, i) => ({ id: `s${i}`, createdAt: 1000 + i }));

describe('card colours', () => {
	it('gives the cards on the page a colour each, up to the size of the palette', () => {
		const shown = cards(TONE_COUNT);
		const tones = assignTones(shown, shown, {});
		expect(new Set(shown.map((card) => tones.get(card.id))).size).toBe(TONE_COUNT);
	});

	it('never gives a card the colour of the card beside it, even with more cards than colours', () => {
		const shown = cards(TONE_COUNT * 2 + 3);
		const tones = assignTones(shown, shown, {});
		shown.slice(1).forEach((card, i) => {
			expect(tones.get(card.id)).not.toBe(tones.get(shown[i]!.id));
		});
	});

	it('keeps colours already given, and fits new cards around them', () => {
		const shown = cards(4);
		// The second and third cards already have the same colour; a new card between keeps away from both.
		const tones = assignTones(shown, shown, { s0: 3, s1: 3, s3: 5 });
		expect(tones.get('s0')).toBe(3);
		expect(tones.get('s1')).toBe(3);
		expect(tones.get('s3')).toBe(5);
		expect([3, 5]).not.toContain(tones.get('s2'));
		// A colour outside the palette, from an older version, is replaced.
		expect(assignTones(shown.slice(0, 1), shown.slice(0, 1), { s0: 99 }).get('s0')).toBe(0);
	});

	it('colours closed cards too: their kept colour, else by creation order', () => {
		const all = cards(3);
		const tones = assignTones([], all, { s2: 6 });
		expect(tones.get('s0')).toBe(0);
		expect(tones.get('s1')).toBe(1);
		expect(tones.get('s2')).toBe(6);
	});
});
