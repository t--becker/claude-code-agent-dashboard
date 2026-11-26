import { useCallback, useEffect, useMemo, useState } from 'react';
import { PERMISSION_MODES, type PermissionMode, type Session } from '@shared/types';
import { AgentCard } from './components/AgentCard';
import { ClosedSessions } from './components/ClosedSessions';
import { FolderPrompt } from './components/FolderPrompt';
import { ChevronIcon, LogoMark, PlusIcon, YourPicture } from './components/icons';
import { TopicLogos } from './components/TopicIcon';
import { Notice } from './components/Notice';
import { ReplyBanner } from './components/ReplyBanner';
import { SearchBox } from './components/SearchBox';
import { useNow } from './hooks/useNow';
import { useWorkspace } from './hooks/useWorkspace';
import { countByFilter, filterOf, type Filter } from './lib/groups';
import { moveCard, orderSessions } from './lib/order';
import { sessionTones } from './lib/sessionTone';
import { forgetSession, loadUiState, saveUiState, type UiState } from './lib/uiState';

const NO_LOGOS: Record<string, string> = {};

export function App() {
	const { state, actions } = useWorkspace();
	const now = useNow();
	const [ui, setUi] = useState<UiState>(() => loadUiState());
	const [notice, setNotice] = useState<{
		sessionId?: string;
		message: string;
		undo?: () => void;
	} | null>(null);

	const patchUi = useCallback((patch: Partial<UiState>) => {
		setUi((prev) => ({ ...prev, ...patch }));
		saveUiState(patch);
	}, []);

	const sessions = useMemo(
		() => Object.values(state.sessions).sort((a, b) => b.createdAt - a.createdAt),
		[state.sessions]
	);
	const tones = useMemo(() => sessionTones(sessions), [sessions]);
	const open = useMemo(
		() =>
			orderSessions(
				sessions.filter((s) => !s.closed),
				ui.order,
				ui.pinned
			),
		[sessions, ui.order, ui.pinned]
	);
	const closed = useMemo(() => sessions.filter((s) => s.closed), [sessions]);
	const focusedId = ui.focusedId && open.some((s) => s.id === ui.focusedId) ? ui.focusedId : null;

	// Which cards the page shows. An agent that is waiting on you is a banner above the cards;
	// every other open agent is a card, running or finished, in the order you arranged them.
	const [filter, setFilter] = useState<Filter>('all');
	const counts = useMemo(() => countByFilter(open), [open]);
	const asBanner = (s: Session) =>
		s.state === 'Needs input' && Boolean(s.pendingInput) && focusedId !== s.id;
	const banners =
		focusedId || (filter !== 'all' && filter !== 'reply') ? [] : open.filter(asBanner);
	const cards = open.filter((s) => !asBanner(s));
	const shown = (s: Session) =>
		focusedId ? s.id === focusedId : filter === 'all' || filterOf(s) === filter;
	const togglePin = (id: string) =>
		patchUi({
			pinned: ui.pinned.includes(id) ? ui.pinned.filter((p) => p !== id) : [...ui.pinned, id],
		});

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') patchUi({ focusedId: null });
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [patchUi]);

	useEffect(() => {
		if (!notice) return;
		const timer = setTimeout(() => setNotice(null), 12_000);
		return () => clearTimeout(timer);
	}, [notice]);

	// One switch for every card.
	const setAllPermissions = async (mode: PermissionMode) => {
		try {
			await actions.setAllPermissions(mode);
		} catch (err) {
			setNotice({ message: err instanceof Error ? err.message : String(err) });
		}
	};

	// A new agent needs one thing, its folder. The card opens ready for the first prompt.
	const [picking, setPicking] = useState(false);
	const [pickerProblem, setPickerProblem] = useState<string>();
	const [newId, setNewId] = useState<string>();

	const startIn = async (folder: string) => {
		const session = await actions.create({ path: folder });
		setNewId(session.id);
		patchUi({ createOpen: false, focusedId: null });
	};

	const newAgent = async () => {
		setPickerProblem(undefined);
		if (!state.config?.folderPicker) {
			patchUi({ createOpen: true, focusedId: null });
			return;
		}
		setPicking(true);
		try {
			const picked = await actions.pickFolder();
			if (picked.path) await startIn(picked.path);
		} catch (err) {
			// The chooser could not open: ask for the folder on the page instead.
			setPickerProblem(err instanceof Error ? err.message : String(err));
			patchUi({ createOpen: true, focusedId: null });
		} finally {
			setPicking(false);
		}
	};

	// Dragging a card by its header onto another puts it there. The order is this browser's own.
	const [dragId, setDragId] = useState<string | null>(null);
	const [dropId, setDropId] = useState<string | null>(null);
	const dropOn = (targetId: string) => {
		if (dragId && dragId !== targetId) {
			patchUi({
				order: moveCard(
					open.map((s) => s.id),
					dragId,
					targetId
				),
			});
		}
		setDragId(null);
		setDropId(null);
	};

	const closeSession = async (session: Session) => {
		await actions.close(session.id);
		if (focusedId === session.id) patchUi({ focusedId: null });
		const running = session.state === 'Running' || session.state === 'Needs input';
		setNotice({
			sessionId: session.id,
			message: `${session.title} closed. ${running ? 'Still running in Closed sessions.' : 'Session kept in Closed sessions.'}`,
			undo: () => void reopenSession(session),
		});
	};

	const reopenSession = async (session: Session) => {
		await actions.reopen(session.id);
		setNotice(null);
	};

	// A search result opens its chat in the full view; a closed one comes back to the page first.
	const openFromSearch = async (session: Session) => {
		try {
			if (session.closed) await actions.reopen(session.id);
			setFilter('all');
			patchUi({ focusedId: session.id });
		} catch (err) {
			setNotice({ message: err instanceof Error ? err.message : String(err) });
		}
	};

	const removeSession = async (session: Session) => {
		const running = session.state === 'Running' || session.state === 'Needs input';
		const confirmed = window.confirm(
			`Delete “${session.title}” and its conversation?${running ? ' This stops the running agent.' : ''}`
		);
		if (!confirmed) return;
		await actions.remove(session.id);
		forgetSession(session.id);
	};

	const providerSummary = state.providers
		.map(
			(p) =>
				`${p.label}: ${p.mode === 'live' ? `connected · models from ${p.modelsSource}` : `demo mode (${p.reason})`}`
		)
		.join(' · ');

	const chips: { id: Filter; label: string }[] = [
		{ id: 'all', label: 'All' },
		{ id: 'reply', label: 'Needs reply' },
		{ id: 'running', label: 'Running' },
		{ id: 'done', label: 'Done' },
	];
	const mode = state.config?.defaultPermissionMode;

	const card = (session: Session) => (
		<AgentCard
			key={session.id}
			session={session}
			stream={state.streams[session.id]}
			activity={state.activities[session.id]}
			provider={state.providers.find((p) => p.id === session.provider)}
			tone={tones.get(session.id)}
			focused={focusedId === session.id}
			hidden={!shown(session)}
			now={now}
			actions={actions}
			autoFocusPrompt={session.id === newId}
			pinned={ui.pinned.includes(session.id)}
			onTogglePin={() => togglePin(session.id)}
			dragging={dragId !== null}
			dropTarget={dropId === session.id && dragId !== session.id}
			onDragStart={() => setDragId(session.id)}
			onDragEnd={() => {
				setDragId(null);
				setDropId(null);
			}}
			onDragOverCard={() => setDropId(session.id)}
			onDropCard={() => dropOn(session.id)}
			onExpand={() => patchUi({ focusedId: session.id })}
			onShrink={() => patchUi({ focusedId: null })}
			onClose={() => void closeSession(session)}
		/>
	);

	return (
		<YourPicture.Provider value={state.config?.avatar}>
			<TopicLogos.Provider value={state.config?.logos ?? NO_LOGOS}>
				<div id="agent-home">
					<header className="top">
						<LogoMark />
						<strong>Agent Dashboard</strong>
						<span
							className={`live${state.connected ? ' on' : ' offline'}`}
							role="status"
							title={
								state.connected ? 'Live updates connected' : 'Reconnecting to the workspace server…'
							}
						>
							<i aria-hidden="true" />
							{state.connected ? 'Live' : 'Reconnecting…'}
						</span>
						<SearchBox sessions={sessions} tones={tones} onOpen={(s) => void openFromSearch(s)} />
						<button
							type="button"
							className="new-agent"
							onClick={() => void newAgent()}
							disabled={!state.loaded || picking}
						>
							{!picking && <PlusIcon />}
							{picking ? 'Choose a folder…' : 'New agent'}
						</button>
					</header>

					<div className="intro">
						<h2>Your agents</h2>
						<div className="chips" role="group" aria-label="Show">
							{chips
								.filter((chip) => chip.id !== 'reply' || counts.reply > 0 || filter === 'reply')
								.map((chip) => (
									<button
										key={chip.id}
										type="button"
										className={`chip${filter === chip.id ? ' on' : ''}`}
										aria-pressed={filter === chip.id}
										onClick={() => {
											setFilter(chip.id);
											patchUi({ focusedId: null });
										}}
									>
										{chip.label} <span className={`count count-${chip.id}`}>{counts[chip.id]}</span>
									</button>
								))}
						</div>
						<div className="tools">
							{state.loaded && mode && (
								<label className="all-permissions">
									Permissions
									<select
										aria-label="Permissions for all agents"
										title="Sets every card, and the cards that appear later. Applies from each agent’s next prompt."
										value={mode}
										onChange={(event) =>
											void setAllPermissions(event.target.value as PermissionMode)
										}
									>
										{PERMISSION_MODES.map((m) => (
											<option key={m.id} value={m.id}>
												{m.label}
											</option>
										))}
									</select>
								</label>
							)}
							<button
								type="button"
								className={`return${focusedId ? ' visible' : ''}`}
								onClick={() => patchUi({ focusedId: null })}
							>
								← All agents
							</button>
						</div>
					</div>

					{mode === 'bypassPermissions' && (
						<div className="permission-warning" role="note">
							Agents run every command, edit and connected tool without asking you first. Applies
							from each agent’s next prompt, and to new and mirrored cards.
						</div>
					)}

					{state.loadError && !state.loaded && (
						<div className="notice" role="alert">
							<span>
								Could not reach the workspace server: {state.loadError}. Start it with `npm run
								dev`.
							</span>
						</div>
					)}

					{ui.createOpen && state.loaded && (
						<FolderPrompt
							config={state.config}
							reason={pickerProblem}
							onStart={startIn}
							onCancel={() => patchUi({ createOpen: false })}
						/>
					)}

					{notice && (
						<Notice
							message={notice.message}
							onUndo={notice.undo}
							onDismiss={() => setNotice(null)}
						/>
					)}

					{banners.map((session) => (
						<ReplyBanner
							key={session.id}
							session={session}
							input={session.pendingInput!}
							tone={tones.get(session.id)}
							pinned={ui.pinned.includes(session.id)}
							actions={actions}
							onTogglePin={() => togglePin(session.id)}
							onViewChat={() => patchUi({ focusedId: session.id })}
							onClose={() => void closeSession(session)}
						/>
					))}

					<div className={`grid${focusedId ? ' focused' : ''}`}>{cards.map(card)}</div>

					{state.loaded && open.length === 0 && (
						<div className="empty">
							No open agents. Press New agent and choose a project folder.
						</div>
					)}
					{state.loaded &&
						open.length > 0 &&
						!focusedId &&
						banners.length === 0 &&
						!cards.some(shown) && <div className="empty">No agents match this filter.</div>}
					{!state.loaded && !state.loadError && (
						<div className="empty">Connecting to the workspace server…</div>
					)}

					{state.loaded && !focusedId && (
						<button
							type="button"
							className="section-toggle"
							aria-expanded={ui.archiveOpen}
							onClick={() => patchUi({ archiveOpen: !ui.archiveOpen })}
						>
							<ChevronIcon open={ui.archiveOpen} />
							Closed sessions ({closed.length})
						</button>
					)}
					{ui.archiveOpen && !focusedId && (
						<ClosedSessions
							sessions={closed}
							tones={tones}
							onReopen={(s) => void reopenSession(s)}
							onRemove={(s) => void removeSession(s)}
						/>
					)}

					<div className="demo">{providerSummary || 'Detecting agent tools…'}</div>
				</div>
			</TopicLogos.Provider>
		</YourPicture.Provider>
	);
}
