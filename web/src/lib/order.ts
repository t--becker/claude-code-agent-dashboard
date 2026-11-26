import type { Session } from '@shared/types';

/**
 * Cards in the order the reader arranged them. Pinned cards lead. A card not placed yet (a new
 * agent, a chat that was just mirrored in) comes next, newest on top, so it is never buried.
 */
export function orderSessions(
	sessions: Session[],
	order: string[],
	pinned: string[] = []
): Session[] {
	const position = new Map(order.map((id, index) => [id, index]));
	const placed = sessions
		.filter((s) => position.has(s.id))
		.sort((a, b) => position.get(a.id)! - position.get(b.id)!);
	const unplaced = sessions
		.filter((s) => !position.has(s.id))
		.sort((a, b) => b.createdAt - a.createdAt);
	const arranged = [...unplaced, ...placed];
	const isPinned = new Set(pinned);
	return [
		...arranged.filter((s) => isPinned.has(s.id)),
		...arranged.filter((s) => !isPinned.has(s.id)),
	];
}

/** Moves one card to where another sits; the cards between them shift by one. */
export function moveCard(ids: string[], moving: string, target: string): string[] {
	const from = ids.indexOf(moving);
	const to = ids.indexOf(target);
	if (from < 0 || to < 0 || from === to) return ids;
	const next = [...ids];
	next.splice(from, 1);
	next.splice(to, 0, moving);
	return next;
}
