import type { Session } from '@shared/types';

export interface SearchHit {
	session: Session;
	/** Where the words were found: the title, or a line of the chat. */
	where: 'title' | 'you' | 'agent' | 'step';
	/** A stretch of text around the first match, for the result row. */
	snippet: string;
	/** How many messages in the chat contain every word. */
	matches: number;
}

const SNIPPET_BEFORE = 40;
const SNIPPET_LENGTH = 150;

const wordsOf = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);

const hasAll = (text: string, words: string[]) => {
	const lower = text.toLowerCase();
	return words.every((word) => lower.includes(word));
};

function snippetOf(text: string, words: string[]): string {
	const flat = text.replace(/\s+/g, ' ').trim();
	const at = Math.max(0, flat.toLowerCase().indexOf(words[0] ?? ''));
	const start = Math.max(0, at - SNIPPET_BEFORE);
	const piece = flat.slice(start, start + SNIPPET_LENGTH);
	return `${start > 0 ? '…' : ''}${piece}${start + SNIPPET_LENGTH < flat.length ? '…' : ''}`;
}

/**
 * Finds chats, open or closed, where every word of the query appears in the title, the project
 * or one message. Chats matched by their title come first, then the most recently active.
 */
export function searchSessions(sessions: Session[], query: string, limit = 30): SearchHit[] {
	const words = wordsOf(query);
	if (!words.length) return [];
	const hits: (SearchHit & { rank: number })[] = [];
	for (const session of sessions) {
		const heading = `${session.title} ${session.project} ${session.branch}`;
		let first: Pick<SearchHit, 'where' | 'snippet'> | undefined;
		let matches = 0;
		// Newest first, so the snippet is the latest place the words came up.
		for (let i = session.transcript.length - 1; i >= 0; i -= 1) {
			const entry = session.transcript[i]!;
			const text =
				entry.kind === 'user' || entry.kind === 'assistant'
					? entry.text
					: entry.kind === 'tool'
						? `${entry.name} ${entry.summary}`
						: '';
			if (!text || !hasAll(text, words)) continue;
			matches += 1;
			first ??= {
				where: entry.kind === 'user' ? 'you' : entry.kind === 'assistant' ? 'agent' : 'step',
				snippet: snippetOf(text, words),
			};
		}
		const inTitle = hasAll(heading, words);
		if (!inTitle && !first) continue;
		hits.push({
			session,
			where: first?.where ?? 'title',
			snippet: first?.snippet ?? `${session.project} / ${session.branch}`,
			matches,
			rank: inTitle ? 0 : 1,
		});
	}
	return hits
		.sort((a, b) => a.rank - b.rank || b.session.updatedAt - a.session.updatedAt)
		.slice(0, limit)
		.map(({ rank: _rank, ...hit }) => hit);
}

/** Splits text around the query's words, so the result row can mark them. */
export function markWords(text: string, query: string): { text: string; hit: boolean }[] {
	const words = wordsOf(query).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
	if (!words.length) return [{ text, hit: false }];
	const pattern = new RegExp(`(${words.join('|')})`, 'gi');
	// Splitting on a captured group puts the matches at the odd positions, so mark them before
	// dropping the empty pieces a match at either end leaves behind.
	return text
		.split(pattern)
		.map((part, index) => ({ text: part, hit: index % 2 === 1 }))
		.filter((part) => part.text);
}
