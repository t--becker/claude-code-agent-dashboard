import type { Activity, AgentState, Session } from '@shared/types';

/**
 * A mirrored chat runs in its own window (VS Code, a terminal), so the workspace has no run
 * of its own to report. Its card follows that window's busy flag instead, and names the tool
 * step it is waiting on when the chat's saved history shows one.
 */
export function mirroredActivity(session: Session): Activity | undefined {
	const open = session.external?.open;
	if (!open || open.status !== 'busy') return undefined;
	if (session.state === 'Running' || session.state === 'Needs input') return undefined;
	const where = open.client ? ` in ${open.client}` : '';
	const last = session.transcript.at(-1);
	const step =
		last?.kind === 'tool' && last.output === undefined ? `Running ${last.name}` : 'Working';
	return { label: `${step}${where}`, since: open.statusSince ?? session.updatedAt };
}

/** The state a card shows: a chat busy in another window counts as running. */
export const shownState = (session: Session): AgentState =>
	mirroredActivity(session) ? 'Running' : session.state;

/** A card that was just created and has nothing to report yet. */
export const isFresh = (session: Session): boolean =>
	shownState(session) === 'Done' && session.turns === 0 && session.transcript.length === 0;

/** The filter chips above the cards. Every open agent falls under exactly one of the last three. */
export type Filter = 'all' | 'reply' | 'running' | 'done';

export function filterOf(session: Session): Exclude<Filter, 'all'> {
	const state = shownState(session);
	if (state === 'Needs input') return 'reply';
	return state === 'Running' ? 'running' : 'done';
}

export function countByFilter(sessions: Session[]): Record<Filter, number> {
	const counts: Record<Filter, number> = { all: sessions.length, reply: 0, running: 0, done: 0 };
	for (const session of sessions) counts[filterOf(session)] += 1;
	return counts;
}
