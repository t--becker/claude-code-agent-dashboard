import { useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@shared/types';
import { shownState } from '../lib/groups';
import { markWords, searchSessions } from '../lib/search';
import { SearchIcon } from './icons';
import { TopicTile } from './TopicIcon';

interface Props {
	/** Every chat the workspace holds, open and closed. */
	sessions: Session[];
	tones: Map<string, number>;
	/** Opens the chosen chat; a closed one is reopened first. */
	onOpen: (session: Session) => void;
}

const WHERE = { title: '', you: 'You: ', agent: 'Reply: ', step: 'Step: ' } as const;

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** One box that looks through every chat, open or closed: titles, your prompts and the replies. */
export function SearchBox({ sessions, tones, onOpen }: Props) {
	const [query, setQuery] = useState('');
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(0);
	const input = useRef<HTMLInputElement>(null);
	const wrap = useRef<HTMLDivElement>(null);
	const hits = useMemo(() => searchSessions(sessions, query), [sessions, query]);

	// ⌘K (Ctrl+K elsewhere) puts the cursor in the box from anywhere on the page.
	useEffect(() => {
		const shortcut = (event: KeyboardEvent) => {
			if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey)) return;
			event.preventDefault();
			input.current?.focus();
			input.current?.select();
			setOpen(true);
		};
		const outside = (event: MouseEvent) => {
			if (!wrap.current?.contains(event.target as Node)) setOpen(false);
		};
		window.addEventListener('keydown', shortcut);
		document.addEventListener('mousedown', outside);
		return () => {
			window.removeEventListener('keydown', shortcut);
			document.removeEventListener('mousedown', outside);
		};
	}, []);

	const choose = (session: Session) => {
		setOpen(false);
		setQuery('');
		input.current?.blur();
		onOpen(session);
	};

	const showing = open && query.trim().length > 0;
	return (
		<div className="search" ref={wrap}>
			<SearchIcon />
			<input
				ref={input}
				type="search"
				role="combobox"
				aria-label="Search chats"
				aria-expanded={showing}
				aria-controls="search-results"
				aria-autocomplete="list"
				placeholder="Search chats"
				autoComplete="off"
				spellCheck={false}
				value={query}
				onFocus={() => setOpen(true)}
				onChange={(event) => {
					setQuery(event.target.value);
					setActive(0);
					setOpen(true);
				}}
				onKeyDown={(event) => {
					if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
						event.preventDefault();
						if (!hits.length) return;
						const step = event.key === 'ArrowDown' ? 1 : -1;
						setActive((active + step + hits.length) % hits.length);
					} else if (event.key === 'Enter') {
						const hit = hits[active];
						if (hit) choose(hit.session);
					} else if (event.key === 'Escape') {
						// Escape first shuts the results; the page's own Escape is left for the next press.
						event.stopPropagation();
						setOpen(false);
						input.current?.blur();
					}
				}}
			/>
			<kbd aria-hidden="true">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
			{showing && (
				<div className="search-results" id="search-results" role="listbox" aria-label="Chats found">
					{hits.length === 0 && <div className="search-empty">No chat mentions that.</div>}
					{hits.map((hit, index) => {
						const { session } = hit;
						const state = shownState(session);
						return (
							<button
								key={session.id}
								type="button"
								role="option"
								aria-selected={index === active}
								className={`search-hit tone-${tones.get(session.id) ?? 0}${index === active ? ' active' : ''}`}
								onMouseEnter={() => setActive(index)}
								onClick={() => choose(session)}
							>
								<TopicTile session={session} small />
								<span className="search-text">
									<span className="search-title">
										{markWords(session.title, query).map((part, n) =>
											part.hit ? <mark key={n}>{part.text}</mark> : part.text
										)}
									</span>
									<span className="search-snippet">
										{WHERE[hit.where]}
										{markWords(hit.snippet, query).map((part, n) =>
											part.hit ? <mark key={n}>{part.text}</mark> : part.text
										)}
									</span>
								</span>
								<span className="search-meta">
									<span className={`search-state${session.closed ? ' closed' : ''}`}>
										{session.closed ? 'Closed' : state === 'Needs input' ? 'Needs reply' : state}
									</span>
									{hit.matches > 1 && <span>{hit.matches} messages</span>}
								</span>
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
}
