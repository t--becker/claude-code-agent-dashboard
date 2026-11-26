import { useEffect, useRef, useState } from 'react';
import { MoreIcon } from './icons';

export interface MenuItem {
	label: string;
	onSelect: () => void;
	danger?: boolean;
}

/** The "…" on a card: the things you do to a chat now and then, kept out of the header. */
export function CardMenu({ label, items }: { label: string; items: MenuItem[] }) {
	const [open, setOpen] = useState(false);
	const wrap = useRef<HTMLSpanElement>(null);

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

	return (
		<span className="card-menu" ref={wrap}>
			<button
				type="button"
				className="icon-btn more"
				aria-haspopup="menu"
				aria-expanded={open}
				aria-label={label}
				onClick={() => setOpen(!open)}
			>
				<MoreIcon />
			</button>
			{open && (
				<div className="menu" role="menu">
					{items.map((item) => (
						<button
							key={item.label}
							type="button"
							role="menuitem"
							className={item.danger ? 'danger' : undefined}
							onClick={() => {
								setOpen(false);
								item.onSelect();
							}}
						>
							{item.label}
						</button>
					))}
				</div>
			)}
		</span>
	);
}
