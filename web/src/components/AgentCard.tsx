import {
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type FormEvent,
	type KeyboardEvent,
} from 'react';
import {
	MAX_FILES,
	MAX_TOTAL_BYTES,
	PERMISSION_MODES,
	type Activity,
	type AgentState,
	type PermissionMode,
	type ProviderInfo,
	type Session,
} from '@shared/types';
import { timeAgo } from '../hooks/useNow';
import type { WorkspaceActions } from '../hooks/useWorkspace';
import { formatBytes, pastedFiles, readFiles, type ComposerFile } from '../lib/attachments';
import { isFresh, mirroredActivity } from '../lib/groups';
import { readDraft, readScroll, writeDraft, writeScroll } from '../lib/uiState';
import { CardMenu } from './CardMenu';
import {
	ExpandIcon,
	PinIcon,
	PlusIcon,
	SendIcon,
	SettingsIcon,
	ShrinkIcon,
	StatusMark,
} from './icons';
import { OutputsBar } from './OutputsBar';
import { PendingInputBox } from './PendingInputBox';
import { TopicIcon } from './TopicIcon';
import { Transcript } from './Transcript';

export { mirroredActivity };

interface Props {
	session: Session;
	stream?: string;
	/** The step a running agent is on, when the server has reported one. */
	activity?: Activity;
	provider?: ProviderInfo;
	tone?: number;
	focused: boolean;
	hidden: boolean;
	now: number;
	actions: WorkspaceActions;
	/** Puts the cursor in the prompt box, for a card that was just created. */
	autoFocusPrompt?: boolean;
	/** True while any card is being dragged to a new place. */
	dragging?: boolean;
	/** True while the dragged card is over this one. */
	dropTarget?: boolean;
	/** Pinned cards lead the page and never fold into Finished sessions. */
	pinned?: boolean;
	onTogglePin?: () => void;
	onDragStart?: () => void;
	onDragEnd?: () => void;
	onDragOverCard?: () => void;
	onDropCard?: () => void;
	onExpand: () => void;
	onShrink: () => void;
	onClose: () => void;
}

const STATE_CLASS: Record<AgentState, string> = {
	Running: '',
	'Needs input': 'waiting',
	Stopped: 'stopped',
	Done: 'completed',
	Error: 'error',
};

/** How long a run has been going, counted by the second. */
function Stopwatch({ since }: { since: number }) {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, []);
	const seconds = Math.max(0, Math.floor((now - since) / 1000));
	const minutes = Math.floor(seconds / 60);
	const text =
		minutes >= 60
			? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
			: minutes
				? `${minutes}m ${seconds % 60}s`
				: `${seconds}s`;
	return <>{text}</>;
}

function activityLabel(session: Session, state: AgentState, now: number): string {
	const ago = timeAgo(session.updatedAt, now);
	switch (state) {
		case 'Running':
			return `Updated ${ago}`;
		case 'Needs input':
			return `Waiting for you · ${ago}`;
		case 'Done':
			return `Completed ${ago}`;
		case 'Stopped':
			return `Stopped ${ago}`;
		case 'Error':
			return `Failed ${ago}`;
	}
}

export function AgentCard({
	session,
	stream,
	activity,
	provider,
	tone = 0,
	focused,
	hidden,
	now,
	actions,
	autoFocusPrompt,
	dragging,
	dropTarget,
	pinned = false,
	onTogglePin,
	onDragStart,
	onDragEnd,
	onDragOverCard,
	onDropCard,
	onExpand,
	onShrink,
	onClose,
}: Props) {
	const [draft, setDraft] = useState(() => readDraft(session.id));
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();
	const [initialScroll] = useState(() => readScroll(session.id));
	const [unread, setUnread] = useState(false);
	const [files, setFiles] = useState<ComposerFile[]>([]);
	const [fileOver, setFileOver] = useState(false);
	const [editingTitle, setEditingTitle] = useState(false);
	const [titleDraft, setTitleDraft] = useState(session.title);
	const [pickingIcon, setPickingIcon] = useState(false);
	const [showSettings, setShowSettings] = useState(false);
	const promptRef = useRef<HTMLTextAreaElement>(null);
	const outputRef = useRef<HTMLDivElement>(null);
	const scrollTop = useRef<number | undefined>(initialScroll);
	const pinnedToBottom = useRef(initialScroll === undefined);
	const questionRef = useRef<HTMLDivElement>(null);
	const scrollSaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

	const isBusy = session.state === 'Running' || session.state === 'Needs input';
	// What the card shows. Controls keep using the session's own state: Stop and Send act on
	// workspace runs, and a chat that is busy in another window is not one.
	const mirrored = mirroredActivity(session);
	const shownState: AgentState = mirrored ? 'Running' : session.state;
	const shownActivity = activity ?? mirrored;
	// A card that was just created has nothing to report yet.
	const fresh = isFresh(session);
	// A run started when its prompt was sent; a chat in another window, when that window got busy.
	const runSince =
		mirrored?.since ??
		session.transcript.findLast((item) => item.kind === 'user')?.ts ??
		session.updatedAt;
	const statusLabel = fresh ? 'Ready' : shownState;
	const isDemo = session.providerMode === 'demo';
	const selectedModel = session.nextModel ?? session.model;
	const modelLabel = (id: string) => provider?.models.find((m) => m.id === id)?.label ?? id;

	// Expanding or shrinking re-lays the card out; put the reader back where they were, else at the latest message.
	useLayoutEffect(() => {
		const el = outputRef.current;
		if (!el || hidden) return;
		el.scrollTop = pinnedToBottom.current
			? el.scrollHeight
			: (scrollTop.current ?? el.scrollHeight);
	}, [hidden, focused]);

	// A card that changes place on the page is moved in the document, which resets its scroll to
	// the top. Put the reader back: at the latest message, or wherever they had scrolled to.
	useLayoutEffect(() => {
		const el = outputRef.current;
		if (!el || hidden || el.scrollTop !== 0) return;
		if (pinnedToBottom.current) el.scrollTop = el.scrollHeight;
		else if (scrollTop.current) el.scrollTop = scrollTop.current;
	});

	// Follow new content only while the reader is already at the end; otherwise offer a jump.
	const questionId = session.pendingInput?.id;
	useEffect(() => {
		const el = outputRef.current;
		if (!el || hidden) return;
		if (pinnedToBottom.current) {
			el.scrollTop = el.scrollHeight;
			scrollTop.current = el.scrollTop;
		} else {
			setUnread(true);
		}
	}, [session.transcript.length, stream, questionId, hidden]);

	const scrollToEnd = () => {
		const el = outputRef.current;
		if (!el) return;
		el.scrollTop = el.scrollHeight;
		pinnedToBottom.current = true;
		setUnread(false);
	};

	const onScroll = () => {
		const el = outputRef.current;
		if (!el) return;
		scrollTop.current = el.scrollTop;
		pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
		if (pinnedToBottom.current) setUnread(false);
		if (scrollSaveTimer.current) clearTimeout(scrollSaveTimer.current);
		// At the latest message nothing is saved, so the card reopens there however much has been added.
		const pinned = pinnedToBottom.current;
		scrollSaveTimer.current = setTimeout(
			() => writeScroll(session.id, pinned ? undefined : el.scrollTop),
			250
		);
	};

	const run = async (work: () => Promise<unknown>) => {
		setBusy(true);
		setError(undefined);
		try {
			await work();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	};

	useEffect(() => {
		if (autoFocusPrompt) promptRef.current?.focus();
	}, [autoFocusPrompt]);

	// The prompt box grows with what is typed, up to a few lines.
	useLayoutEffect(() => {
		const el = promptRef.current;
		if (!el || !el.scrollHeight) return;
		el.style.height = 'auto';
		el.style.height = `${Math.min(el.scrollHeight, focused ? 320 : 150)}px`;
	}, [draft, focused, hidden]);

	// A card can change place when its agent starts; keep the cursor in the box you sent from.
	const refocus = useRef(false);
	useEffect(() => {
		if (!refocus.current) return;
		refocus.current = false;
		promptRef.current?.focus();
	}, [session.state]);

	// Files of any type can be pasted, dropped on the card, or picked with the File button.
	const addFiles = async (chosen: File[]) => {
		if (!chosen.length) return;
		const used = files.reduce((sum, file) => sum + file.size, 0);
		const read = await readFiles(chosen, MAX_FILES - files.length, MAX_TOTAL_BYTES - used);
		if (read.files.length) setFiles((prev) => [...prev, ...read.files].slice(0, MAX_FILES));
		setError(read.problems.length ? read.problems.join('. ') : undefined);
	};

	const startRename = () => {
		setTitleDraft(session.title);
		setEditingTitle(true);
	};
	const saveTitle = () => {
		if (!editingTitle) return;
		setEditingTitle(false);
		const next = titleDraft.trim();
		if (next && next !== session.title) void run(() => actions.rename(session.id, next));
	};

	const submit = (event?: FormEvent) => {
		event?.preventDefault();
		const text = draft.trim();
		if ((!text && !files.length) || isBusy || busy) return;
		// Sending means you want the reply: go to the latest message and follow what arrives.
		scrollToEnd();
		writeScroll(session.id, undefined);
		refocus.current = document.activeElement === promptRef.current;
		const sending = files.map(({ name, mediaType, data }) => ({ name, mediaType, data }));
		void run(async () => {
			if (sending.length) await actions.prompt(session.id, text, sending);
			else await actions.prompt(session.id, text);
			setDraft('');
			writeDraft(session.id, '');
			setFiles([]);
		});
	};

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
		event.preventDefault();
		submit();
	};

	const controlLabel = isBusy ? 'Stop' : session.state === 'Stopped' ? 'Resume' : undefined;
	const placeholder =
		session.state === 'Running'
			? 'Running… stop it to give new direction'
			: session.state === 'Needs input'
				? 'Answer the question first'
				: 'Message agent…';
	const hint = busy
		? 'Sending…'
		: session.external && !isBusy
			? 'Sending continues this chat here as its own branch'
			: undefined;

	const settings = (
		<div className="settings">
			<div className="model-settings">
				<label>
					Agent tool
					<div>
						{session.providerLabel}
						{isDemo ? ` · demo mode (${provider?.reason ?? 'not connected'})` : ''}
					</div>
				</label>
				<label>
					Model for the next prompt
					<select
						aria-label="Model for the next prompt"
						value={selectedModel}
						disabled={busy}
						onChange={(event) => void run(() => actions.setModel(session.id, event.target.value))}
					>
						{(provider?.models ?? [{ id: session.model, label: session.model }]).map((m) => (
							<option key={m.id} value={m.id} title={m.description}>
								{m.label}
							</option>
						))}
					</select>
				</label>
				{(provider?.supportsPermissionModes ?? true) && (
					<label>
						Permissions for the next prompt
						<select
							aria-label="Permissions for the next prompt"
							value={session.permissionMode}
							disabled={busy}
							onChange={(event) =>
								void run(() =>
									actions.setPermissionMode(session.id, event.target.value as PermissionMode)
								)
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
			</div>
			<div className="model-note">
				{session.nextModel
					? `Next prompt: ${modelLabel(session.nextModel)}. Current run stays on ${modelLabel(session.model)}.`
					: `Using ${modelLabel(session.model)}.`}
			</div>
			<div className="context-lines">
				Branch: {session.branch} · Working directory: {session.path}
			</div>
			<details className="context-lines">
				<summary>Session details</summary>
				<p>
					{[
						`Agent tool: ${session.providerLabel} (${session.providerMode})`,
						`Permissions: ${PERMISSION_MODES.find((m) => m.id === session.permissionMode)?.label ?? session.permissionMode}`,
						`Provider session: ${session.providerSessionId ?? 'not started'}`,
						`Turns: ${session.turns}${session.costUsd !== undefined ? ` · Cost: $${session.costUsd.toFixed(4)}` : ''}`,
						`Created: ${new Date(session.createdAt).toLocaleString()}`,
						session.lastError ? `Last error: ${session.lastError}` : '',
					]
						.filter(Boolean)
						.join('\n')}
				</p>
			</details>
		</div>
	);

	return (
		<section
			className={`agent tone-${tone} ${focused ? 'selected' : ''} ${STATE_CLASS[shownState]}${dropTarget ? ' drop-target' : ''}${fileOver ? ' file-over' : ''}`
				.replace(/\s+/g, ' ')
				.trim()}
			data-session-id={session.id}
			data-state={shownState}
			hidden={hidden && !focused ? true : undefined}
			aria-label={session.title}
			onDragOver={(event) => {
				if (dragging) {
					// Another card is being moved: this one is where it would land.
					event.preventDefault();
					event.dataTransfer.dropEffect = 'move';
					onDragOverCard?.();
				} else if (event.dataTransfer.types.includes('Files')) {
					event.preventDefault();
					event.dataTransfer.dropEffect = 'copy';
					setFileOver(true);
				}
			}}
			onDragLeave={() => setFileOver(false)}
			onDrop={(event) => {
				if (dragging) {
					event.preventDefault();
					onDropCard?.();
				} else if (event.dataTransfer.types.includes('Files')) {
					event.preventDefault();
					setFileOver(false);
					void addFiles([...event.dataTransfer.files]);
				}
			}}
		>
			<div
				className={`agent-head${onDragStart && !focused ? ' movable' : ''}`}
				draggable={Boolean(onDragStart) && !focused && !editingTitle && !pickingIcon}
				onDragStart={(event) => {
					event.dataTransfer.setData('text/plain', session.id);
					event.dataTransfer.effectAllowed = 'move';
					onDragStart?.();
				}}
				onDragEnd={onDragEnd}
			>
				<TopicIcon
					session={session}
					open={pickingIcon}
					onOpenChange={setPickingIcon}
					onPick={(icon) => void run(() => actions.setIcon(session.id, icon))}
				/>
				<div className="head-title">
					{editingTitle ? (
						<input
							id={`title-${session.id}`}
							className="title-input"
							aria-label="Chat title"
							value={titleDraft}
							maxLength={120}
							autoFocus
							onFocus={(event) => event.target.select()}
							onChange={(event) => setTitleDraft(event.target.value)}
							onBlur={saveTitle}
							onKeyDown={(event) => {
								if (event.key === 'Enter') {
									event.preventDefault();
									saveTitle();
								} else if (event.key === 'Escape') {
									event.stopPropagation();
									setEditingTitle(false);
								}
							}}
						/>
					) : (
						<div className="title-row">
							<h3 onDoubleClick={startRename} title="Double-click to rename">
								{session.title}
							</h3>
							{pinned && onTogglePin && (
								<button
									type="button"
									className="pin on"
									aria-label={`Unpin ${session.title}`}
									title="Pinned to the front. Click to unpin."
									onClick={onTogglePin}
								>
									<PinIcon filled size={14} />
								</button>
							)}
						</div>
					)}
					<div className="status-line">
						<StatusMark state={shownState} ready={fresh} />
						<span className="status">{statusLabel}</span>
						<span className="elapsed">
							{shownState === 'Running' ? (
								<Stopwatch key={runSince} since={runSince} />
							) : fresh ? null : (
								activityLabel(session, shownState, now)
							)}
						</span>
						<span className="meta" title={session.path}>
							{session.project} / {session.branch}
						</span>
						<span className="model-tag" title={session.model}>
							{modelLabel(session.model)}
						</span>
						{isDemo && (
							<span className="engine-tag demo-tag" title={provider?.reason}>
								Demo mode
							</span>
						)}
					</div>
				</div>
				{focused && (
					<button
						type="button"
						className="open-chat"
						aria-label={`Shrink ${session.title}`}
						onClick={onShrink}
					>
						<ShrinkIcon />
						Shrink
					</button>
				)}
				<CardMenu
					label={`More for ${session.title}`}
					items={[
						focused
							? { label: 'Back to all agents', onSelect: onShrink }
							: { label: 'Open chat', onSelect: onExpand },
						...(onTogglePin
							? [{ label: pinned ? 'Unpin' : 'Pin to the front', onSelect: onTogglePin }]
							: []),
						{ label: 'Rename', onSelect: startRename },
						{ label: 'Change icon', onSelect: () => setPickingIcon(true) },
						{ label: 'Close', onSelect: onClose, danger: true },
					]}
				/>
			</div>

			<div className="output" ref={outputRef} onScroll={onScroll}>
				{focused && settings}

				{session.transcript.length === 0 && !stream && shownState !== 'Running' && (
					<p className="empty-chat">
						{session.state === 'Error'
							? (session.lastError ?? 'The agent failed.')
							: fresh
								? `Ready in ${session.path}. Type the first prompt below.`
								: 'No output yet.'}
					</p>
				)}
				<Transcript
					entries={session.transcript}
					running={shownState === 'Running'}
					stream={stream}
					activity={shownActivity}
					cwd={session.path}
					provider={session.provider}
				>
					{session.pendingInput && session.state === 'Needs input' && (
						<div ref={questionRef}>
							<PendingInputBox
								input={session.pendingInput}
								project={session.project}
								disabled={busy}
								onAnswer={(answer) => void run(() => actions.answer(session.id, answer))}
							/>
						</div>
					)}
				</Transcript>
				{unread && (
					<button type="button" className="jump" onClick={scrollToEnd}>
						↓ New messages
					</button>
				)}
			</div>

			{showSettings && !focused && settings}

			<OutputsBar
				outputs={session.outputs ?? []}
				transcript={session.transcript}
				title={session.title}
			/>

			<form className="composer" onSubmit={submit}>
				{files.length > 0 && (
					<div className="attachments">
						{files.map((file) => (
							<span key={file.id} className={`attachment${file.url ? '' : ' file-chip'}`}>
								{file.url ? (
									<img src={file.url} alt={file.name} />
								) : (
									<>
										<span className="file-name">{file.name}</span>
										<span className="file-size">{formatBytes(file.size)}</span>
									</>
								)}
								<button
									type="button"
									aria-label={`Remove ${file.name}`}
									onClick={() => setFiles((prev) => prev.filter((f) => f.id !== file.id))}
								>
									×
								</button>
							</span>
						))}
					</div>
				)}
				<div className="prompt">
					<textarea
						ref={promptRef}
						rows={1}
						placeholder={placeholder}
						aria-label={`Prompt ${session.title}`}
						value={draft}
						onPaste={(event) => {
							const pasted = pastedFiles(event.clipboardData);
							if (!pasted.length) return;
							event.preventDefault();
							void addFiles(pasted);
						}}
						onChange={(event) => {
							setDraft(event.target.value);
							writeDraft(session.id, event.target.value);
						}}
						onKeyDown={onKeyDown}
					/>
					<div className="prompt-tools">
						<label
							className="attach icon-btn"
							title="Attach files of any type. You can also paste or drop them."
						>
							<input
								id={`attach-${session.id}`}
								type="file"
								className="visually-hidden"
								aria-label={`Attach files to ${session.title}`}
								multiple
								onChange={(event) => {
									void addFiles([...(event.target.files ?? [])]);
									event.target.value = '';
								}}
							/>
							<PlusIcon />
						</label>
						{!focused && (
							<button
								type="button"
								className={`icon-btn${showSettings ? ' on' : ''}`}
								aria-label={`Settings for ${session.title}`}
								aria-pressed={showSettings}
								title="Model and permissions for the next prompt"
								onClick={() => setShowSettings(!showSettings)}
							>
								<SettingsIcon />
							</button>
						)}
						<span className={`prompt-foot${error ? ' problem' : ''}`}>{error ?? hint}</span>
						{controlLabel && (
							<button
								type="button"
								className="run-control"
								disabled={busy}
								onClick={() =>
									void run(() => (isBusy ? actions.stop(session.id) : actions.resume(session.id)))
								}
							>
								{controlLabel}
							</button>
						)}
						{!focused && (
							<button
								type="button"
								className="icon-btn"
								aria-label={`Expand ${session.title}`}
								title="Open in the full view"
								onClick={onExpand}
							>
								<ExpandIcon />
							</button>
						)}
						<button
							type="submit"
							className="send"
							aria-label="Send"
							title="Send (Enter). Shift+Enter adds a line."
							disabled={isBusy || busy || (!draft.trim() && !files.length)}
						>
							<SendIcon />
						</button>
					</div>
				</div>
			</form>
		</section>
	);
}
