import type { Session } from '@shared/types';

/** How many card colours there are; each is a `tone-N` class in styles.css. */
export const TONE_COUNT = 8;

/**
 * Gives every card a colour of its own, keeping the ones already given.
 *
 * Cards on the page are coloured in the order they are shown: each new one takes the colour
 * used least among the cards so far, and never the colour of the card before or after it, so
 * the page shows as many colours as it has cards (up to eight) and neighbours always differ.
 * A colour once given is kept (`kept`), so closing, reopening or moving a card never recolours
 * it or its neighbours. Closed cards nobody has seen yet take one in creation order.
 */
export function assignTones(
	shown: Pick<Session, 'id'>[],
	all: Pick<Session, 'id' | 'createdAt'>[],
	kept: Record<string, number>
): Map<string, number> {
	const valid = (tone: unknown): tone is number =>
		typeof tone === 'number' && Number.isInteger(tone) && tone >= 0 && tone < TONE_COUNT;
	const tones = new Map<string, number>();
	const used = new Array<number>(TONE_COUNT).fill(0);
	const give = (id: string, tone: number) => {
		tones.set(id, tone);
		used[tone]! += 1;
	};
	// The colours already given to cards on the page count first, wherever those cards sit.
	for (const card of shown) if (valid(kept[card.id])) give(card.id, kept[card.id]!);
	shown.forEach((card, index) => {
		if (tones.has(card.id)) return;
		const before = index > 0 ? tones.get(shown[index - 1]!.id) : undefined;
		const after = index < shown.length - 1 ? tones.get(shown[index + 1]!.id) : undefined;
		let best = -1;
		for (let tone = 0; tone < TONE_COUNT; tone += 1) {
			if (tone === before || tone === after) continue;
			if (best < 0 || used[tone]! < used[best]!) best = tone;
		}
		give(card.id, best);
	});
	const oldestFirst = [...all].sort((a, b) => a.createdAt - b.createdAt);
	oldestFirst.forEach((session, index) => {
		if (tones.has(session.id)) return;
		tones.set(session.id, valid(kept[session.id]) ? kept[session.id]! : index % TONE_COUNT);
	});
	return tones;
}
