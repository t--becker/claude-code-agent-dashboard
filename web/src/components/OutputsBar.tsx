import { useEffect, useRef, useState } from 'react';
import {
	AppWindow,
	ArrowRight,
	ArrowUpRight,
	BookOpenText,
	ChartColumn,
	CodeXml,
	FileText,
	GitPullRequest,
	Link as LinkIcon,
	MessageSquare,
	PenTool,
	SquareCheckBig,
	type LucideIcon,
} from 'lucide-react';
import { FILE_ROUTE, type ChatOutput, type OutputKind, type TranscriptEntry } from '@shared/types';
import { CloseIcon } from './icons';

interface Props {
	outputs: ChatOutput[];
	/** The chat, for showing the edits behind "Code changes". */
	transcript: TranscriptEntry[];
	title: string;
}

const ICONS: Record<OutputKind, LucideIcon> = {
	artifact: AppWindow,
	page: BookOpenText,
	ticket: SquareCheckBig,
	doc: FileText,
	design: PenTool,
	dashboard: ChartColumn,
	message: MessageSquare,
	pr: GitPullRequest,
	file: FileText,
	code: CodeXml,
	link: LinkIcon,
};

const EDITORS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

const short = (file: string) => file.split('/').slice(-2).join('/');

/** The edits a chat made, file by file, as far as the chat's history still holds them. */
function CodeChanges({
	output,
	transcript,
	onClose,
}: {
	output: ChatOutput;
	transcript: TranscriptEntry[];
	onClose: () => void;
}) {
	const files = output.files ?? [];
	const editsOf = (file: string) =>
		transcript.filter(
			(entry) =>
				entry.kind === 'tool' && EDITORS.has(entry.name) && entry.summary === file && entry.diff
		) as Extract<TranscriptEntry, { kind: 'tool' }>[];

	useEffect(() => {
		const escape = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			event.stopPropagation();
			onClose();
		};
		document.addEventListener('keydown', escape, true);
		return () => document.removeEventListener('keydown', escape, true);
	}, [onClose]);

	return (
		<div
			className="overlay"
			onMouseDown={(event) => event.target === event.currentTarget && onClose()}
		>
			<div className="changes" role="dialog" aria-modal="true" aria-label="Code changes">
				<div className="changes-head">
					<strong>
						Code changes · {files.length} file{files.length === 1 ? '' : 's'}
					</strong>
					<button
						type="button"
						className="icon-btn"
						aria-label="Close code changes"
						onClick={onClose}
					>
						<CloseIcon />
					</button>
				</div>
				<div className="changes-body">
					{files.map((file) => {
						const edits = editsOf(file);
						return (
							<section key={file} aria-label={file}>
								<h4 title={file}>{short(file)}</h4>
								{edits.length === 0 && (
									<p className="meta">
										These edits are no longer in the part of the chat kept here.
									</p>
								)}
								{edits.map((edit) => (
									<pre key={edit.id} className="diff">
										{edit.diff!.split('\n').map((line, index) => (
											<span
												key={index}
												className={
													line.startsWith('+')
														? 'added'
														: line.startsWith('-')
															? 'removed'
															: undefined
												}
											>
												{line || ' '}
												{'\n'}
											</span>
										))}
									</pre>
								))}
							</section>
						);
					})}
				</div>
			</div>
		</div>
	);
}

/** How many outputs are named on the line itself; the rest wait behind "+N more". */
const INLINE = 2;

/**
 * What the chat has made, on one line at the foot of the card: the newest few as links, the
 * rest a click away. Pages, tickets, artifacts and files open in a new tab; code changes open
 * the edits themselves.
 */
export function OutputsBar({ outputs, transcript, title }: Props) {
	const [open, setOpen] = useState(false);
	const [showCode, setShowCode] = useState(false);
	const wrap = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const outside = (event: MouseEvent) => {
			if (!wrap.current?.contains(event.target as Node)) setOpen(false);
		};
		const escape = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			event.stopPropagation();
			setOpen(false);
		};
		document.addEventListener('mousedown', outside);
		document.addEventListener('keydown', escape, true);
		return () => {
			document.removeEventListener('mousedown', outside);
			document.removeEventListener('keydown', escape, true);
		};
	}, [open]);

	if (!outputs.length) return null;
	const code = outputs.find((output) => output.kind === 'code');
	// Newest first: what the chat made last is what you most likely want.
	const listed = [...outputs].reverse();
	const hrefOf = (output: ChatOutput) =>
		output.url ?? (output.file ? `${FILE_ROUTE}${encodeURI(output.file)}` : undefined);
	const openCode = () => {
		// The panel takes over from the list, so Escape has one thing to close.
		setOpen(false);
		setShowCode(true);
	};

	return (
		<div className="outputs" ref={wrap} role="group" aria-label={`Outputs of ${title}`}>
			<span className="outputs-label">Outputs</span>
			{listed.slice(0, INLINE).map((output) => {
				const Icon = ICONS[output.kind] ?? LinkIcon;
				const href = hrefOf(output);
				const hint = `${output.label} · ${output.verb}`;
				if (output.kind === 'code')
					return (
						<button key={output.key} type="button" className="output-link" onClick={openCode}>
							<Icon size={18} strokeWidth={1.9} aria-hidden="true" />
							<span>View diff ({output.label})</span>
						</button>
					);
				return href ? (
					<a
						key={output.key}
						className="output-link"
						href={href}
						target="_blank"
						rel="noreferrer"
						title={hint}
					>
						<Icon size={18} strokeWidth={1.9} aria-hidden="true" />
						<span>{output.title}</span>
						<ArrowUpRight size={15} strokeWidth={2} aria-hidden="true" />
					</a>
				) : (
					<span key={output.key} className="output-link plain" title={hint}>
						<Icon size={18} strokeWidth={1.9} aria-hidden="true" />
						<span>{output.title}</span>
					</span>
				);
			})}
			{listed.length > INLINE && (
				<button
					type="button"
					className="outputs-more"
					aria-expanded={open}
					onClick={() => setOpen(!open)}
				>
					+{listed.length - INLINE} more
				</button>
			)}
			{open && (
				<div className="outputs-list" role="list" aria-label={`All outputs of ${title}`}>
					{listed.map((output) => {
						const Icon = ICONS[output.kind] ?? LinkIcon;
						const href = hrefOf(output);
						const inner = (
							<>
								<span className={`output-icon kind-${output.kind}`}>
									<Icon size={20} strokeWidth={1.9} aria-hidden="true" />
								</span>
								<span className="output-text">
									<strong>{output.title}</strong>
									<span>
										{output.label} · {output.verb}
									</span>
								</span>
								{(href || output.kind === 'code') && (
									<ArrowRight size={18} strokeWidth={1.9} aria-hidden="true" />
								)}
							</>
						);
						return (
							<div key={output.key} role="listitem">
								{output.kind === 'code' ? (
									<button type="button" className="output-row" onClick={openCode}>
										{inner}
									</button>
								) : href ? (
									<a className="output-row" href={href} target="_blank" rel="noreferrer">
										{inner}
									</a>
								) : (
									<div className="output-row plain">{inner}</div>
								)}
							</div>
						);
					})}
				</div>
			)}
			{showCode && code && (
				<CodeChanges output={code} transcript={transcript} onClose={() => setShowCode(false)} />
			)}
		</div>
	);
}
