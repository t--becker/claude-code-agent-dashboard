import { useCallback, useEffect, useReducer, useRef } from 'react';
import type {
	Activity,
	AnswerInput,
	CreateSessionInput,
	PermissionMode,
	PromptFile,
	ProviderInfo,
	ServerEvent,
	Session,
	WorkspaceConfig,
} from '@shared/types';
import { api } from '../api';

export interface WorkspaceState {
	loaded: boolean;
	connected: boolean;
	sessions: Record<string, Session>;
	providers: ProviderInfo[];
	config?: WorkspaceConfig;
	streams: Record<string, string>;
	activities: Record<string, Activity>;
	loadError?: string;
}

type Action =
	| { type: 'snapshot'; providers: ProviderInfo[]; sessions: Session[]; config: WorkspaceConfig }
	| { type: 'session'; session: Session }
	| { type: 'removed'; id: string }
	| { type: 'stream'; sessionId: string; text: string }
	| { type: 'activity'; sessionId: string; activity?: Activity }
	| { type: 'connected'; connected: boolean }
	| { type: 'loadError'; message: string };

const initial: WorkspaceState = {
	loaded: false,
	connected: false,
	sessions: {},
	providers: [],
	streams: {},
	activities: {},
};

function reducer(state: WorkspaceState, action: Action): WorkspaceState {
	switch (action.type) {
		case 'snapshot': {
			const sessions: Record<string, Session> = {};
			for (const session of action.sessions) sessions[session.id] = session;
			return {
				...state,
				loaded: true,
				loadError: undefined,
				providers: action.providers,
				config: action.config,
				sessions,
			};
		}
		case 'session': {
			const existing = state.sessions[action.session.id];
			if (existing && existing.updatedAt > action.session.updatedAt) return state;
			return { ...state, sessions: { ...state.sessions, [action.session.id]: action.session } };
		}
		case 'removed': {
			const sessions = { ...state.sessions };
			delete sessions[action.id];
			const streams = { ...state.streams };
			delete streams[action.id];
			const activities = { ...state.activities };
			delete activities[action.id];
			return { ...state, sessions, streams, activities };
		}
		case 'activity': {
			const activities = { ...state.activities };
			if (action.activity) activities[action.sessionId] = action.activity;
			else delete activities[action.sessionId];
			return { ...state, activities };
		}
		case 'stream': {
			const streams = { ...state.streams };
			if (action.text) streams[action.sessionId] = action.text;
			else delete streams[action.sessionId];
			return { ...state, streams };
		}
		case 'connected':
			return { ...state, connected: action.connected };
		case 'loadError':
			return { ...state, loadError: action.message };
	}
}

export function useWorkspace() {
	const [state, dispatch] = useReducer(reducer, initial);
	const socketRef = useRef<WebSocket | null>(null);

	useEffect(() => {
		let closed = false;
		let retry = 0;
		let timer: ReturnType<typeof setTimeout> | undefined;

		api
			.bootstrap()
			.then((body) => dispatch({ type: 'snapshot', ...body }))
			.catch((err: Error) => dispatch({ type: 'loadError', message: err.message }));

		const connect = () => {
			if (closed) return;
			const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
			const socket = new WebSocket(`${protocol}://${location.host}/ws`);
			socketRef.current = socket;
			socket.onopen = () => {
				retry = 0;
				dispatch({ type: 'connected', connected: true });
			};
			socket.onmessage = (message) => {
				const event = JSON.parse(String(message.data)) as ServerEvent;
				if (event.type === 'snapshot')
					dispatch({
						type: 'snapshot',
						providers: event.providers,
						sessions: event.sessions,
						config: event.config,
					});
				else if (event.type === 'session') dispatch({ type: 'session', session: event.session });
				else if (event.type === 'stream')
					dispatch({ type: 'stream', sessionId: event.sessionId, text: event.text });
				else if (event.type === 'activity')
					dispatch({ type: 'activity', sessionId: event.sessionId, activity: event.activity });
			};
			socket.onclose = () => {
				dispatch({ type: 'connected', connected: false });
				if (closed) return;
				retry += 1;
				timer = setTimeout(connect, Math.min(10_000, 500 * 2 ** Math.min(retry, 5)));
			};
			socket.onerror = () => socket.close();
		};
		connect();

		return () => {
			closed = true;
			if (timer) clearTimeout(timer);
			socketRef.current?.close();
		};
	}, []);

	const apply = useCallback((session: Session) => dispatch({ type: 'session', session }), []);

	const actions = {
		create: useCallback(
			async (input: CreateSessionInput) => {
				const session = await api.create(input);
				apply(session);
				return session;
			},
			[apply]
		),
		prompt: useCallback(
			async (id: string, text: string, files: PromptFile[] = []) =>
				apply(await api.prompt(id, text, files)),
			[apply]
		),
		rename: useCallback(
			async (id: string, title: string) => apply(await api.rename(id, title)),
			[apply]
		),
		setIcon: useCallback(
			async (id: string, icon: string | null) => apply(await api.setIcon(id, icon)),
			[apply]
		),
		pickFolder: useCallback(() => api.pickFolder(), []),
		stop: useCallback(async (id: string) => apply(await api.stop(id)), [apply]),
		resume: useCallback(async (id: string) => apply(await api.resume(id)), [apply]),
		close: useCallback(async (id: string) => apply(await api.close(id)), [apply]),
		reopen: useCallback(async (id: string) => apply(await api.reopen(id)), [apply]),
		setModel: useCallback(
			async (id: string, model: string) => apply(await api.setModel(id, model)),
			[apply]
		),
		setPermissionMode: useCallback(
			async (id: string, mode: PermissionMode) => apply(await api.setPermissionMode(id, mode)),
			[apply]
		),
		setAllPermissions: useCallback(async (mode: PermissionMode) => {
			dispatch({ type: 'snapshot', ...(await api.setAllPermissions(mode)) });
		}, []),
		answer: useCallback(
			async (id: string, input: AnswerInput) => apply(await api.answer(id, input)),
			[apply]
		),
		remove: useCallback(async (id: string) => {
			await api.remove(id);
			dispatch({ type: 'removed', id });
		}, []),
	};

	return { state, actions };
}

export type WorkspaceActions = ReturnType<typeof useWorkspace>['actions'];
