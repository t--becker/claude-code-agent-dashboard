import type { Session } from '@shared/types';

export const TONE_COUNT = 6;

// Numbered by creation order across open and closed sessions, so neighbours in the newest-first
// grid differ and closing a card never recolours the others.
export function sessionTones(sessions: Pick<Session, 'id' | 'createdAt'>[]): Map<string, number> {
	const oldestFirst = [...sessions].sort((a, b) => a.createdAt - b.createdAt);
	return new Map(oldestFirst.map((s, i) => [s.id, i % TONE_COUNT]));
}
