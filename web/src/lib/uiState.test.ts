import {
	forgetSession,
	loadUiState,
	readDraft,
	readScroll,
	saveUiState,
	writeDraft,
	writeScroll,
} from './uiState';

describe('uiState', () => {
	beforeEach(() => localStorage.clear());

	it('returns defaults when nothing is stored or the stored value is corrupt', () => {
		expect(loadUiState()).toEqual({
			focusedId: null,
			archiveOpen: false,
			createOpen: false,
			permissionMode: 'default',
			drafts: {},
			scroll: {},
			order: [],
			pinned: [],
		});
		localStorage.setItem('agent-workspace:ui', '{not json');
		expect(loadUiState().focusedId).toBeNull();
	});

	it('merges patches and keeps drafts and scroll positions per session', () => {
		saveUiState({ focusedId: 'a', archiveOpen: true });
		writeDraft('a', 'hello');
		writeScroll('a', 120);
		writeDraft('b', '');
		expect(loadUiState()).toMatchObject({
			focusedId: 'a',
			archiveOpen: true,
			drafts: { a: 'hello' },
			scroll: { a: 120 },
		});
		expect(readDraft('a')).toBe('hello');
		expect(readDraft('b')).toBe('');
		expect(readScroll('a')).toBe(120);
		expect(readScroll('b')).toBeUndefined();
	});

	it('never hands out the shared defaults, so a draft written before anything is stored cannot leak', () => {
		writeDraft('a', 'n');
		localStorage.clear();
		expect(readDraft('a')).toBe('');
		expect(loadUiState().drafts).toEqual({});
	});

	it('forgets a session and drops focus on it', () => {
		saveUiState({ focusedId: 'a' });
		writeDraft('a', 'x');
		writeScroll('a', 5);
		forgetSession('a');
		expect(loadUiState()).toMatchObject({ focusedId: null, drafts: {}, scroll: {} });
	});
});
