import { sessionTones, TONE_COUNT } from './sessionTone';

describe('sessionTones', () => {
	it('steps through the palette in creation order regardless of input order', () => {
		const sessions = Array.from({ length: TONE_COUNT + 2 }, (_, i) => ({
			id: `s${i}`,
			createdAt: 1000 + i,
		})).reverse();
		const tones = sessionTones(sessions);
		expect(tones.get('s0')).toBe(0);
		expect(tones.get('s1')).toBe(1);
		expect(tones.get(`s${TONE_COUNT}`)).toBe(0);
		expect(tones.get(`s${TONE_COUNT + 1}`)).toBe(1);
	});
});
