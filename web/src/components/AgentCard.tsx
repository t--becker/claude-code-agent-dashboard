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
import { ClipIcon, PinIcon, SendIcon, ShrinkIcon } from './icons';
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

/** Models offered first when the one a chat is on has run out, in this order. */
const PREFERRED_FALLBACKS = ['opus', 'sonnet', 'default'];

const LIMIT_TEXT =
	/\b(?:reached|hit|exceeded|used up)\b.{0,40}\b(?:usage |rate |weekly |daily )?(?:limit|quota)\b|\busage limit\b/i;

/**
 * The chat's last word, when it is a short reply saying the model's usage limit is reached and
 * nothing has been asked since; with the prompt that met it, to send again on another model.
 */
export function limitMessage(session: Session): { prompt?: string } | undefined {
	const spoken = session.transcript.filter(
		(entry) => entry.kind === 'user' || entry.kind === 'assistant' || entry.kind === 'error'
	);
	const last = spoken.at(-1);
	if (!last || last.kind === 'user' || last.text.length > 300 || !LIMIT_TEXT.test(last.text))
		return undefined;
	const asked = spoken.findLast((entry) => entry.kind === 'user');
	return { prompt: asked?.kind === 'user' && asked.text.trim() ? asked.text : undefined };
}

/** How close to the last message still counts as being at the end, in pixels. */
const NEAR_END = 80;
/** How long after a wheel, touch or key press a scroll is taken to be the reader's. */
const INPUT_MS = 400;
/** How long after the layout changes a scroll may be the layout's doing. */
const SETTLE_MS = 250;

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

	// Keeping a reader at the latest message.
	//
	// "At the end" is a decision the reader makes by scrolling, so it is only ever taken away by
	// a scroll that was theirs. New content, a step folding shut, the card changing size or place:
	// all of those move the scroll position too, and the browser reports each as a scroll. Read as
	// the reader's own, they would leave the card stranded short of the end with a "New messages"
	// button, which is what used to happen whenever several steps arrived at once.
	const lastInput = useRef(0);
	const pointerDown = useRef(false);
	const settleUntil = useRef(0);
	const measured = useRef({ content: 0, box: 0 });

	/** After anything that may have changed the layout: stay at the end, or where the reader was. */
	const stick = () => {
		const el = outputRef.current;
		if (!el || hidden) return;
		if (el.scrollHeight !== measured.current.content || el.clientHeight !== measured.current.box) {
			measured.current = { content: el.scrollHeight, box: el.clientHeight };
			// For a moment after the layout changes, a scroll may be its doing and not the reader's.
			settleUntil.current = performance.now() + SETTLE_MS;
		}
		if (pinnedToBottom.current) {
			if (el.scrollHeight - el.scrollTop - el.clientHeight > 1) el.scrollTop = el.scrollHeight;
		} else if (scrollTop.current && el.scrollTop === 0) {
			// A card moved in the document has its scroll reset to the top; put the reader back.
			el.scrollTop = scrollTop.current;
		}
	};
	const stickRef = useRef(stick);
	// Before the browser paints each update, so the end never shows a gap.
	useLayoutEffect(() => {
		stickRef.current = stick;
		stick();
	});
	// And when something grows without an update from here: a picture loading, a step opened by
	// hand, the message box getting taller.
	useEffect(() => {
		const el = outputRef.current;
		if (!el || hidden || typeof ResizeObserver === 'undefined') return;
		const observer = new ResizeObserver(() => stickRef.current());
		observer.observe(el);
		for (const child of el.children) observer.observe(child);
		return () => observer.disconnect();
	}, [hidden, focused]);

	// When the reader is elsewhere in the chat, say that something new has arrived.
	const questionId = session.pendingInput?.id;
	const latest = `${session.transcript.at(-1)?.id ?? ''}|${stream ? 'stream' : ''}|${questionId ?? ''}`;
	const noticed = useRef(latest);
	useEffect(() => {
		if (hidden || noticed.current === latest) return;
		noticed.current = latest;
		if (!pinnedToBottom.current) setUnread(true);
	}, [latest, hidden]);

	const scrollToEnd = () => {
		const el = outputRef.current;
		if (!el) return;
		pinnedToBottom.current = true;
		el.scrollTop = el.scrollHeight;
		setUnread(false);
	};

	/** A wheel, a touch, a key or a press on the scrollbar: the next scroll is the reader's. */
	const noteInput = () => {
		lastInput.current = performance.now();
	};
	const onPointerDown = () => {
		noteInput();
		pointerDown.current = true;
		const release = () => {
			pointerDown.current = false;
			noteInput();
			window.removeEventListener('pointerup', release);
			window.removeEventListener('pointercancel', release);
		};
		window.addEventListener('pointerup', release);
		window.addEventListener('pointercancel', release);
	};

	const onScroll = () => {
		const el = outputRef.current;
		if (!el) return;
		const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_END;
		const now = performance.now();
		const theirs =
			pointerDown.current || now - lastInput.current < INPUT_MS || now > settleUntil.current;
		if (atEnd) pinnedToBottom.current = true;
		else if (theirs) pinnedToBottom.current = false;
		else if (pinnedToBottom.current) {
			// The layout moved it, not the reader: go back to the end and leave the decision alone.
			stick();
			return;
		}
		scrollTop.current = el.scrollTop;
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

	// A reply saying the model's usage limit is reached is the end of the road on that model:
	// offer another one, and to send the last prompt again on it.
	const limitReply = !isBusy ? limitMessage(session) : undefined;
	const others = (provider?.models ?? []).filter((m) => m.id !== session.model);
	const [switchTo, setSwitchTo] = useState<string>();
	const suggested =
		switchTo && others.some((m) => m.id === switchTo)
			? switchTo
			: (
					PREFERRED_FALLBACKS.map(
						(name) => others.find((m) => m.id === name) ?? others.find((m) => m.id.includes(name))
					).find(Boolean) ?? others[0]
				)?.id;
	const switchAndRetry = (model: string) =>
		void run(async () => {
			await actions.setModel(session.id, model);
			if (limitReply?.prompt) await actions.prompt(session.id, limitReply.prompt);
		});

	const settings = (
		<div className="settings">
			{!focused && (
				<button
					type="button"
					className="icon-btn settings-close"
					aria-label="Close settings"
					onClick={() => setShowSettings(false)}
				>
					×
				</button>
			)}
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
						<span className="status-pill">
							<span className="status">{statusLabel}</span>
							<span className="elapsed">
								{shownState === 'Running' ? (
									<Stopwatch key={runSince} since={runSince} />
								) : fresh ? null : (
									activityLabel(session, shownState, now)
								)}
							</span>
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
						{
							label: `Change model (${modelLabel(selectedModel)})`,
							onSelect: () => {
								if (!focused) return setShowSettings(true);
								// The full view keeps them at the top of the chat: go there and stay there.
								pinnedToBottom.current = false;
								outputRef.current?.scrollTo({ top: 0 });
							},
						},
						{ label: 'Rename', onSelect: startRename },
						{ label: 'Change icon', onSelect: () => setPickingIcon(true) },
						{ label: 'Close', onSelect: onClose, danger: true },
					]}
				/>
			</div>

			<div
				className="output"
				ref={outputRef}
				onScroll={onScroll}
				onWheel={noteInput}
				onTouchStart={noteInput}
				onTouchMove={noteInput}
				onKeyDown={noteInput}
				onPointerDown={onPointerDown}
			>
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
					detailed={focused}
				>
					{limitReply && suggested && (
						<div className="limit-notice" role="group" aria-label="Usage limit reached">
							<span>{modelLabel(session.model)} has reached its usage limit.</span>
							<select
								aria-label="Model to switch to"
								value={suggested}
								disabled={busy}
								onChange={(event) => setSwitchTo(event.target.value)}
							>
								{others.map((m) => (
									<option key={m.id} value={m.id}>
										{m.label}
									</option>
								))}
							</select>
							<button
								type="button"
								className="primary"
								disabled={busy}
								onClick={() => switchAndRetry(suggested)}
							>
								{limitReply.prompt ? 'Switch and send again' : 'Switch model'}
							</button>
						</div>
					)}
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
					<label
						className="attach"
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
						<ClipIcon />
					</label>
					<textarea
						ref={promptRef}
						rows={1}
						placeholder={placeholder}
						title={hint}
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
				{error && <div className="prompt-foot problem">{error}</div>}
			</form>
		</section>
	);
}
