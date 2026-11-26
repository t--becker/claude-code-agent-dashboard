// Icons used across the page. Line icons come from lucide; they follow the text colour of the
// element they sit in.

import { createContext, useContext } from 'react';
import {
	Check,
	ChevronDown,
	Ellipsis,
	GitBranch,
	LoaderCircle,
	Maximize2,
	MessageCircle,
	Minimize2,
	Pencil,
	Pin,
	Plus,
	Search,
	Send,
	SlidersHorizontal,
	Terminal,
	User,
	X,
} from 'lucide-react';
import type { AgentState, ProviderId } from '@shared/types';

interface IconProps {
	size?: number;
}

const common = { 'aria-hidden': true, focusable: false, strokeWidth: 1.9 } as const;

export const PinIcon = ({ size = 16, filled = false }: IconProps & { filled?: boolean }) => (
	<Pin size={size} {...common} fill={filled ? 'currentColor' : 'none'} />
);
export const ChatIcon = ({ size = 16 }: IconProps) => <MessageCircle size={size} {...common} />;
export const ExpandIcon = ({ size = 16 }: IconProps) => <Maximize2 size={size} {...common} />;
export const ShrinkIcon = ({ size = 16 }: IconProps) => <Minimize2 size={size} {...common} />;
export const SendIcon = ({ size = 18 }: IconProps) => <Send size={size} {...common} />;
export const PlusIcon = ({ size = 18 }: IconProps) => <Plus size={size} {...common} />;
export const SettingsIcon = ({ size = 18 }: IconProps) => (
	<SlidersHorizontal size={size} {...common} />
);
export const MoreIcon = ({ size = 20 }: IconProps) => <Ellipsis size={size} {...common} />;
export const SearchIcon = ({ size = 18 }: IconProps) => <Search size={size} {...common} />;
export const PencilIcon = ({ size = 14 }: IconProps) => <Pencil size={size} {...common} />;
export const CloseIcon = ({ size = 16 }: IconProps) => <X size={size} {...common} />;
export const BranchIcon = ({ size = 13 }: IconProps) => <GitBranch size={size} {...common} />;
export const TerminalIcon = ({ size = 15 }: IconProps) => (
	<Terminal size={size} {...common} strokeWidth={2.2} />
);
export const SpinnerIcon = ({ size = 16 }: IconProps) => (
	<LoaderCircle size={size} {...common} className="spin" />
);
export const ChevronIcon = ({ size = 16, open = false }: IconProps & { open?: boolean }) => (
	<ChevronDown
		size={size}
		{...common}
		className="chevron"
		style={{ transform: open ? 'rotate(180deg)' : undefined }}
	/>
);

/** The mark in front of a status word: a tick when done, a dot otherwise. */
export function StatusMark({ state, ready }: { state: AgentState; ready?: boolean }) {
	if (state === 'Done' && !ready)
		return (
			<span className="status-mark done" aria-hidden="true">
				<Check size={11} strokeWidth={3.5} />
			</span>
		);
	return <span className="status-mark dot" aria-hidden="true" />;
}

/** An eight-ray burst for the agent's side of the chat. */
function BurstIcon({ size = 18 }: IconProps) {
	const rays = Array.from({ length: 8 }, (_, index) => (index * Math.PI) / 4);
	return (
		<svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" focusable={false}>
			{rays.map((angle) => (
				<line
					key={angle}
					x1={10 + Math.cos(angle) * 2.4}
					y1={10 + Math.sin(angle) * 2.4}
					x2={10 + Math.cos(angle) * 8.2}
					y2={10 + Math.sin(angle) * 8.2}
					stroke="currentColor"
					strokeWidth={2.3}
					strokeLinecap="round"
				/>
			))}
		</svg>
	);
}

/** Your own picture for your side of the chat; the page sets it when the workspace has one. */
export const YourPicture = createContext<string | undefined>(undefined);

/** Who is speaking: you, or the agent tool behind the card. */
export function Avatar({ who }: { who: 'you' | ProviderId }) {
	const picture = useContext(YourPicture);
	if (who === 'you' && picture)
		return (
			<span className="avatar avatar-you photo" aria-hidden="true">
				<img src={picture} alt="" />
			</span>
		);
	if (who === 'you')
		return (
			<span className="avatar avatar-you" aria-hidden="true">
				<User size={17} {...common} />
			</span>
		);
	return (
		<span className={`avatar avatar-agent avatar-${who}`} aria-hidden="true">
			<BurstIcon />
		</span>
	);
}

/** Display name of the agent tool on its messages. */
export const agentName = (provider: ProviderId): string =>
	provider === 'codex' ? 'Codex' : 'Claude';
