import { useState, type FormEvent } from 'react';
import type { PendingInput, Session } from '@shared/types';
import type { WorkspaceActions } from '../hooks/useWorkspace';
import { Avatar, BranchIcon, CloseIcon, PinIcon, agentName } from './icons';
import { TopicIcon } from './TopicIcon';

interface Props {
	session: Session;
	input: PendingInput;
	tone?: number;
	pinned: boolean;
	actions: WorkspaceActions;
	onTogglePin: () => void;
	onViewChat: () => void;
	onClose: () => void;
}

/**
 * An agent that has stopped to ask you something sits above the cards, with its question and
 * the answers it offers, so replying never means hunting for the right card.
 */
export function ReplyBanner({
	session,
	input,
	tone = 0,
	pinned,
	actions,
	onTogglePin,
	onViewChat,
	onClose,
}: Props) {
	const [text, setText] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();
	const [pickingIcon, setPickingIcon] = useState(false);
	const permission = input.kind === 'permission';

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
	const sendText = (event: FormEvent) => {
		event.preventDefault();
		const answer = text.trim();
		if (!answer) return;
		void run(async () => {
			await actions.answer(session.id, { text: answer });
			setText('');
		});
	};

	return (
		<section
			className={`reply-banner tone-${tone} waiting`}
			data-session-id={session.id}
			data-state="Needs input"
			aria-label={session.title}
		>
			<div className="reply-who">
				<button
					type="button"
					className={`pin${pinned ? ' on' : ''}`}
					aria-pressed={pinned}
					aria-label={`${pinned ? 'Unpin' : 'Pin'} ${session.title}`}
					onClick={onTogglePin}
				>
					<PinIcon filled={pinned} />
				</button>
				<span className="status">Needs your reply</span>
				<TopicIcon
					session={session}
					open={pickingIcon}
					onOpenChange={setPickingIcon}
					onPick={(icon) => void run(() => actions.setIcon(session.id, icon))}
				/>
				<div className="reply-title">
					<h3>{session.title}</h3>
					<div className="meta" title={session.path}>
						<BranchIcon />
						{session.project} / {session.branch}
					</div>
				</div>
			</div>

			<div className="reply-main" role="group" aria-label={input.title}>
				<div className="reply-question">
					<Avatar who={session.provider} />
					<strong>{agentName(session.provider)}</strong>
					<span className="bubble">
						{input.title}
						{input.toolName && <span className="engine-tag tool-tag">{input.toolName}</span>}
					</span>
					<button type="button" className="link" onClick={onViewChat}>
						View chat
					</button>
				</div>
				{input.detail && <div className={`detail${permission ? ' code' : ''}`}>{input.detail}</div>}
				{permission && (
					<div className="question-help">
						Claude Code asks before it runs commands or changes files in {session.project}. Allow
						lets this one go ahead; Deny tells Claude to find another way.
					</div>
				)}
				<div className="reply-options">
					<span className="reply-label">{permission ? 'Your call' : 'Suggested replies'}</span>
					{input.options.map((option) => (
						<button
							key={option.id}
							type="button"
							className="option"
							title={option.description}
							disabled={busy}
							onClick={() => void run(() => actions.answer(session.id, { optionId: option.id }))}
						>
							{option.label}
						</button>
					))}
					<button
						type="button"
						className="option quiet"
						disabled={busy}
						onClick={() => void run(() => actions.stop(session.id))}
					>
						Stop
					</button>
				</div>
				{input.allowFreeText && (
					<form className="reply-free" onSubmit={sendText}>
						<input
							aria-label="Your answer"
							placeholder="Or type your own reply…"
							value={text}
							disabled={busy}
							onChange={(event) => setText(event.target.value)}
						/>
						<button type="submit" className="primary" disabled={busy || !text.trim()}>
							Send reply
						</button>
					</form>
				)}
				{error && <div className="form-error">{error}</div>}
			</div>

			<button
				type="button"
				className="close-agent"
				aria-label={`Close ${session.title}`}
				onClick={onClose}
			>
				<CloseIcon />
			</button>
		</section>
	);
}
