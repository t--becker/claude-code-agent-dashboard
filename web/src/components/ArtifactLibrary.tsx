import { useEffect, useMemo, useState } from 'react';
import {
	AppWindow,
	ArrowUpRight,
	FileText,
	FileType,
	Presentation,
	Sheet,
	type LucideIcon,
} from 'lucide-react';
import { FILE_ROUTE, type ArtifactItem, type ArtifactKind } from '@shared/types';
import { SearchIcon } from './icons';

interface Props {
	/** Loads the library from the server. */
	load: () => Promise<ArtifactItem[]>;
}

const KINDS: Record<ArtifactKind, { label: string; plural: string; icon: LucideIcon }> = {
	page: { label: 'Web app', plural: 'Web apps', icon: AppWindow },
	pdf: { label: 'PDF', plural: 'PDFs', icon: FileType },
	sheet: { label: 'Spreadsheet', plural: 'Spreadsheets', icon: Sheet },
	doc: { label: 'Document', plural: 'Documents', icon: FileText },
	slides: { label: 'Slides', plural: 'Slides', icon: Presentation },
};

const PAGE_SIZE = 30;

const fileUrl = (file: string) => `${FILE_ROUTE}${encodeURI(file)}`;

const day = (ts: number) =>
	new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });

/** Splits one line of CSV, keeping commas that sit inside quotes. */
export function csvCells(line: string): string[] {
	const cells: string[] = [];
	let cell = '';
	let quoted = false;
	for (let i = 0; i < line.length; i += 1) {
		const char = line[i];
		if (char === '"') {
			if (quoted && line[i + 1] === '"') {
				cell += '"';
				i += 1;
			} else quoted = !quoted;
		} else if (char === ',' && !quoted) {
			cells.push(cell);
			cell = '';
		} else cell += char;
	}
	cells.push(cell);
	return cells;
}

/** The first rows of a CSV, read from the start of the file only. */
function CsvPreview({ file }: { file: string }) {
	const [rows, setRows] = useState<string[][]>();
	useEffect(() => {
		let alive = true;
		void (async () => {
			try {
				const res = await fetch(fileUrl(file));
				const reader = res.body?.getReader();
				const first = reader ? await reader.read() : undefined;
				void reader?.cancel();
				const start = first?.value ? new TextDecoder().decode(first.value) : '';
				const lines = start.split(/\r?\n/).filter(Boolean).slice(0, 6);
				if (alive) setRows(lines.map((line) => csvCells(line).slice(0, 4)));
			} catch {
				if (alive) setRows([]);
			}
		})();
		return () => {
			alive = false;
		};
	}, [file]);
	if (!rows?.length) return null;
	return (
		<table className="artifact-table">
			<tbody>
				{rows.map((row, r) => (
					<tr key={r}>
						{row.map((cell, c) => (r === 0 ? <th key={c}>{cell}</th> : <td key={c}>{cell}</td>))}
					</tr>
				))}
			</tbody>
		</table>
	);
}

/** A small live look at the artifact where one can be shown, else its kind's icon. */
function Preview({ item }: { item: ArtifactItem }) {
	const Icon = KINDS[item.kind].icon;
	if (item.file && item.kind === 'page')
		return (
			<iframe
				className="artifact-live"
				title=""
				aria-hidden="true"
				tabIndex={-1}
				loading="lazy"
				sandbox="allow-scripts"
				src={fileUrl(item.file)}
			/>
		);
	if (item.file && item.kind === 'pdf')
		return (
			<iframe
				className="artifact-live pdf"
				title=""
				aria-hidden="true"
				tabIndex={-1}
				loading="lazy"
				src={`${fileUrl(item.file)}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
			/>
		);
	if (item.file && item.kind === 'sheet' && /\.csv$/i.test(item.file))
		return <CsvPreview file={item.file} />;
	return (
		<div className="artifact-blank">
			<Icon size={56} strokeWidth={1.3} aria-hidden="true" />
			{item.kind === 'page' && <span>Published on claude.ai</span>}
		</div>
	);
}

/** Everything the agents made that is worth finding again, with search and a look at each. */
export function ArtifactLibrary({ load }: Props) {
	const [items, setItems] = useState<ArtifactItem[]>();
	const [error, setError] = useState<string>();
	const [query, setQuery] = useState('');
	const [kind, setKind] = useState<ArtifactKind | 'all'>('all');
	const [shown, setShown] = useState(PAGE_SIZE);

	useEffect(() => {
		let alive = true;
		load().then(
			(found) => alive && setItems(found),
			(err: unknown) => alive && setError(err instanceof Error ? err.message : String(err))
		);
		return () => {
			alive = false;
		};
	}, [load]);

	const counts = useMemo(() => {
		const tally = new Map<ArtifactKind, number>();
		for (const item of items ?? []) tally.set(item.kind, (tally.get(item.kind) ?? 0) + 1);
		return tally;
	}, [items]);

	const matching = useMemo(() => {
		const words = query.toLowerCase().split(/\s+/).filter(Boolean);
		return (items ?? []).filter((item) => {
			if (kind !== 'all' && item.kind !== kind) return false;
			const haystack =
				`${item.title} ${KINDS[item.kind].label} ${item.chatTitle ?? ''} ${item.file ?? ''}`.toLowerCase();
			return words.every((word) => haystack.includes(word));
		});
	}, [items, query, kind]);

	return (
		<section className="library" aria-label="Artifact library">
			<div className="library-head">
				<h1>Artifact library</h1>
				<label className="search library-search">
					<SearchIcon />
					<input
						type="search"
						aria-label="Search artifacts"
						placeholder="Search artifacts..."
						autoComplete="off"
						spellCheck={false}
						value={query}
						onChange={(event) => {
							setQuery(event.target.value);
							setShown(PAGE_SIZE);
						}}
					/>
				</label>
			</div>

			{items && items.length > 0 && (
				<div className="chips" role="group" aria-label="Kind">
					<button
						type="button"
						className={`chip${kind === 'all' ? ' on' : ''}`}
						aria-pressed={kind === 'all'}
						onClick={() => setKind('all')}
					>
						All <span className="count">{items.length}</span>
					</button>
					{(Object.keys(KINDS) as ArtifactKind[])
						.filter((id) => counts.has(id))
						.map((id) => (
							<button
								key={id}
								type="button"
								className={`chip${kind === id ? ' on' : ''}`}
								aria-pressed={kind === id}
								onClick={() => {
									setKind(id);
									setShown(PAGE_SIZE);
								}}
							>
								{KINDS[id].plural} <span className="count">{counts.get(id)}</span>
							</button>
						))}
				</div>
			)}

			{error && (
				<div className="notice" role="alert">
					<span>Could not load the library: {error}</span>
				</div>
			)}
			{!items && !error && <div className="empty">Reading your chats for artifacts…</div>}
			{items?.length === 0 && (
				<div className="empty">
					Nothing here yet. Pages an agent publishes, and the prototypes, PDFs, spreadsheets,
					documents and decks it makes, will appear here.
				</div>
			)}
			{items && items.length > 0 && matching.length === 0 && (
				<div className="empty">No artifact matches that.</div>
			)}

			<div className="library-grid">
				{matching.slice(0, shown).map((item) => {
					const Icon = KINDS[item.kind].icon;
					const where = item.url ? 'on claude.ai' : 'on this computer';
					return (
						<a
							key={item.id}
							className={`artifact kind-${item.kind}`}
							href={item.url ?? (item.file ? fileUrl(item.file) : undefined)}
							target="_blank"
							rel="noreferrer"
							title={item.chatTitle ? `From the chat “${item.chatTitle}”` : undefined}
						>
							<div className="artifact-preview">
								<div className="artifact-band">
									<Icon size={22} strokeWidth={1.8} aria-hidden="true" />
									<span>{item.title}</span>
								</div>
								<div className="artifact-frame">
									<Preview item={item} />
								</div>
							</div>
							<div className="artifact-foot">
								<div>
									<strong>{item.title}</strong>
									<span>
										{KINDS[item.kind].label} · {where} · {day(item.updatedAt)}
									</span>
								</div>
								<ArrowUpRight size={24} strokeWidth={1.8} aria-hidden="true" />
							</div>
						</a>
					);
				})}
			</div>
			{matching.length > shown && (
				<button
					type="button"
					className="secondary more"
					onClick={() => setShown(shown + PAGE_SIZE)}
				>
					Show {Math.min(PAGE_SIZE, matching.length - shown)} more
				</button>
			)}
		</section>
	);
}
