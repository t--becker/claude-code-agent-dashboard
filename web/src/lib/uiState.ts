// Per-browser workspace state. Sessions themselves live on the server; this
// only remembers how this browser was looking at them.

import type { PermissionMode } from '@shared/types';

const KEY = 'agent-workspace:ui';

export interface UiState {
	focusedId: string | null;
	archiveOpen: boolean;
	createOpen: boolean;
	/** Last permission mode picked on the create form. */
	permissionMode: PermissionMode;
	drafts: Record<string, string>;
	scroll: Record<string, number>;
	/** Which way of remembering scroll positions wrote `scroll`; older ones are dropped. */
	scrollRev: number;
	/** Card ids in the order the reader dragged them into. */
	order: string[];
	/** Cards pinned to the top of the page. */
	pinned: string[];
	/** The colour each card was given, so it keeps it. */
	tones: Record<string, number>;
}

/**
 * Positions saved before 2 came from a card that could mistake new messages for the reader
 * scrolling back, so they are not trusted: every card reopens at its latest message once.
 */
const SCROLL_REV = 2;

const defaults: UiState = {
	focusedId: null,
	archiveOpen: false,
	createOpen: false,
	permissionMode: 'default',
	drafts: {},
	scroll: {},
	scrollRev: SCROLL_REV,
	order: [],
	pinned: [],
	tones: {},
};

// Always a fresh copy: callers mutate `drafts` and `scroll`, and a shared default object would leak between sessions.
const fresh = (): UiState => ({
	...defaults,
	drafts: {},
	scroll: {},
	order: [],
	pinned: [],
	tones: {},
});

export function loadUiState(): UiState {
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return fresh();
		const parsed = JSON.parse(raw) as Partial<UiState>;
		return {
			...fresh(),
			...parsed,
			drafts: { ...(parsed.drafts ?? {}) },
			scroll: parsed.scrollRev === SCROLL_REV ? { ...(parsed.scroll ?? {}) } : {},
			scrollRev: SCROLL_REV,
			order: Array.isArray(parsed.order) ? [...parsed.order] : [],
			pinned: Array.isArray(parsed.pinned) ? [...parsed.pinned] : [],
			tones:
				parsed.tones && typeof parsed.tones === 'object' && !Array.isArray(parsed.tones)
					? { ...parsed.tones }
					: {},
		};
	} catch {
		return fresh();
	}
}

export function saveUiState(patch: Partial<UiState>): UiState {
	const next = { ...loadUiState(), ...patch };
	try {
		localStorage.setItem(KEY, JSON.stringify(next));
	} catch {
		// Storage unavailable (private mode, quota): the page still works, it just forgets.
	}
	return next;
}

export function readDraft(id: string): string {
	return loadUiState().drafts[id] ?? '';
}

export function writeDraft(id: string, text: string): void {
	const { drafts } = loadUiState();
	if (text) drafts[id] = text;
	else delete drafts[id];
	saveUiState({ drafts });
}

export function readScroll(id: string): number | undefined {
	return loadUiState().scroll[id];
}

/** Pass undefined when the reader is at the latest message, so the card reopens there. */
export function writeScroll(id: string, top: number | undefined): void {
	const { scroll } = loadUiState();
	if (top === undefined) delete scroll[id];
	else scroll[id] = top;
	saveUiState({ scroll });
}

export function forgetSession(id: string): void {
	const state = loadUiState();
	delete state.drafts[id];
	delete state.scroll[id];
	delete state.tones[id];
	saveUiState({
		drafts: state.drafts,
		scroll: state.scroll,
		tones: state.tones,
		order: state.order.filter((other) => other !== id),
		pinned: state.pinned.filter((other) => other !== id),
		focusedId: state.focusedId === id ? null : state.focusedId,
	});
}
