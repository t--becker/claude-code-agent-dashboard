import { useEffect, useState, type ReactNode } from 'react';
import { FILE_ROUTE, type Activity, type ProviderId, type TranscriptEntry } from '@shared/types';
import { Avatar, ChevronIcon, SpinnerIcon, TerminalIcon, agentName } from './icons';
import { Markdown } from './Markdown';

interface Props {
	entries: TranscriptEntry[];
	/** Highlights the latest tool step while the agent is still working. */
	running: boolean;
	/** Reply text still arriving; shown after the recorded entries. */
	stream?: string;
	/** The step the agent is on ("Thinking", "Running Bash"), shown beside the working dots. */
	activity?: Activity;
	/** Anything that belongs at the very end, such as a pending question. */
	children?: ReactNode;
	/** Folder the agent works in, so file links in replies resolve. */
	cwd?: string;
	/** Which agent tool is on the other side of the chat. */
	provider?: ProviderId;
	/** Shows each run of tool steps unfolded, for the full view. A card keeps them to one line. */
	detailed?: boolean;
}

type ToolEntry = Extract<TranscriptEntry, { kind: 'tool' }>;

/**
 * The steps an agent took between two messages, as one quiet line: how many, which tools, and
 * whether any failed. The conversation stays readable; the detail is a click away.
 */
function StepGroup({
	steps,
	currentId,
	latestId,
	open,
}: {
	steps: ToolEntry[];
	currentId?: string;
	latestId?: string;
	open: boolean;
}) {
	const names = [...new Set(steps.map((step) => step.name.split('__').pop() ?? step.name))];
	const failed = steps.filter((step) => step.isError).length;
	return (
		<details className={`steps${failed ? ' has-failed' : ''}`} open={open || undefined}>
			<summary>
				<ChevronIcon size={14} />
				<strong>
					{steps.length} step{steps.length === 1 ? '' : 's'}
				</strong>
				<span className="steps-names">
					{names.slice(0, 4).join(', ')}
					{names.length > 4 ? '…' : ''}
				</span>
				{failed > 0 && <span className="badge-failed">{failed} failed</span>}
			</summary>
			{steps.map((step) => (
				<ToolStep
					key={step.id}
					entry={step}
					current={step.id === currentId}
					latest={step.id === latestId}
				/>
			))}
		</details>
	);
}

/** Long chats render their tail; the rest is one click away rather than slowing every update. */
export const DEFAULT_VISIBLE_ENTRIES = 150;

const clock = (ts: number) =>
	new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** Seconds a step has been running, shown once it has lasted long enough to be worth counting. */
function Elapsed({ since }: { since: number }) {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, []);
	const seconds = Math.floor((now - since) / 1000);
	if (seconds < 2) return null;
	const text = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
	return <> · {text}</>;
}

/** The lines an edit takes out and puts in, coloured the way a diff is. */
function Diff({ text }: { text: string }) {
	return (
		<pre className="diff" aria-label="Change">
			{text.split('\n').map((line, index) => (
				<span
					key={index}
					className={line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : undefined}
				>
					{line || ' '}
					{'\n'}
				</span>
			))}
		</pre>
	);
}

function ToolStep({
	entry,
	current,
	latest,
}: {
	entry: Extract<TranscriptEntry, { kind: 'tool' }>;
	/** The step the agent is on right now. */
	current: boolean;
	/** The last step in the chat, which is the one most likely to be read. */
	latest: boolean;
}) {
	const className = `step${current ? ' current' : ''}${entry.isError ? ' failed' : ''}`;
	const hasBody = entry.diff !== undefined || entry.output !== undefined;
	const head = (
		<>
			<TerminalIcon />
			<strong>{entry.name}</strong>
			{entry.summary && <span className="step-summary">{entry.summary}</span>}
			{entry.isError && <span className="badge-failed">Failed</span>}
			<time>{clock(entry.ts)}</time>
			{hasBody && <ChevronIcon />}
		</>
	);
	if (!hasBody) {
		return (
			<div className={className}>
				<div className="step-head">{head}</div>
			</div>
		);
	}
	// Folded unless it failed or is the latest: the rest is one click away.
	return (
		<details className={className} open={entry.isError || latest || undefined}>
			<summary className="step-head">{head}</summary>
			{entry.diff !== undefined && <Diff text={entry.diff} />}
			{entry.output !== undefined && <pre>{entry.output || '(no output)'}</pre>}
		</details>
	);
}

export function Transcript({
	entries,
	running,
	stream,
	activity,
	children,
	cwd,
	provider = 'claude-code',
	detailed = false,
}: Props) {
	const [showAll, setShowAll] = useState(false);
	const hidden = showAll ? 0 : Math.max(0, entries.length - DEFAULT_VISIBLE_ENTRIES);
	const visible = hidden ? entries.slice(hidden) : entries;
	const agent = agentName(provider);
	const lastTool = visible.findLast((entry) => entry.kind === 'tool')?.id;
	// Steps that follow one another are shown together, as one line between the messages.
	const rows: (Exclude<TranscriptEntry, ToolEntry> | ToolEntry[])[] = [];
	for (const entry of visible) {
		const last = rows.at(-1);
		if (entry.kind !== 'tool') rows.push(entry);
		else if (Array.isArray(last)) last.push(entry);
		else rows.push([entry]);
	}
	return (
		<div className="response" aria-live="polite">
			{hidden > 0 && (
				<button type="button" className="show-earlier" onClick={() => setShowAll(true)}>
					Show {hidden} earlier entries
				</button>
			)}
			{rows.map((entry) => {
				if (Array.isArray(entry))
					return (
						<StepGroup
							key={entry[0]!.id}
							steps={entry}
							currentId={running ? lastTool : undefined}
							latestId={lastTool}
							open={detailed}
						/>
					);
				switch (entry.kind) {
					case 'user':
						return (
							<div key={entry.id} className="msg you">
								<Avatar who="you" />
								<div className="msg-body">
									<div className="msg-head">
										<strong>You</strong>
										<time>{clock(entry.ts)}</time>
									</div>
									<div className="bubble">
										{entry.text}
										{entry.images?.length ? (
											<span className="sent-images">
												{entry.images.map((file, n) => (
													<a
														key={file}
														href={`${FILE_ROUTE}${encodeURI(file)}`}
														target="_blank"
														rel="noreferrer"
													>
														<img
															src={`${FILE_ROUTE}${encodeURI(file)}`}
															alt={`Attached image ${n + 1}`}
														/>
													</a>
												))}
											</span>
										) : null}
										{entry.files?.length ? (
											<span className="sent-files">
												{entry.files.map((file) => (
													<a
														key={file.path}
														href={`${FILE_ROUTE}${encodeURI(file.path)}`}
														target="_blank"
														rel="noreferrer"
													>
														{file.name}
													</a>
												))}
											</span>
										) : null}
									</div>
								</div>
							</div>
						);
					case 'assistant':
						return (
							<div key={entry.id} className="msg agent-msg">
								<Avatar who={provider} />
								<div className="msg-body">
									<div className="msg-head">
										<strong>{agent}</strong>
										<time>{clock(entry.ts)}</time>
									</div>
									<div className="bubble message">
										<Markdown text={entry.text} cwd={cwd} />
									</div>
								</div>
							</div>
						);
					case 'system':
						return (
							<div key={entry.id} className="note">
								{entry.text}
							</div>
						);
					case 'error':
						return (
							<div key={entry.id} className="note error-note">
								Error: {entry.text}
							</div>
						);
				}
			})}
			{stream && (
				<div className="msg agent-msg">
					<Avatar who={provider} />
					<div className="msg-body">
						<div className="msg-head">
							<strong>{agent}</strong>
						</div>
						<div className="bubble message streaming">
							<Markdown text={stream} cwd={cwd} />
						</div>
					</div>
				</div>
			)}
			{running && !stream && (
				<div className="working">
					<span className="thinking" role="img" aria-label="Working">
						<SpinnerIcon />
					</span>
					<span className="working-label">
						{activity?.label ?? 'Working'}
						{activity && <Elapsed key={activity.since} since={activity.since} />}
					</span>
				</div>
			)}
			{children}
		</div>
	);
}
