import { createContext, useContext, useEffect, useRef } from 'react';
import {
	Bot,
	Bug,
	CalendarDays,
	ChartColumn,
	CircleDollarSign,
	CodeXml,
	Database,
	FileText,
	FlaskConical,
	FolderOpen,
	GitPullRequest,
	Globe,
	GraduationCap,
	Image as ImageIcon,
	Lightbulb,
	Link as LinkIcon,
	ListChecks,
	Mail,
	Megaphone,
	MessageCircleMore,
	MessageSquareText,
	MessagesSquare,
	Metronome,
	Palette,
	Plug,
	Presentation,
	Rocket,
	Scale,
	Search,
	Server,
	Settings,
	Sheet,
	ShieldCheck,
	Smartphone,
	Sparkles,
	Users,
	type LucideIcon,
} from 'lucide-react';
import type { Session } from '@shared/types';
import { DEFAULT_TOPIC, TOPICS, isTopic, suggestTopic, topicLabel } from '@shared/topics';

const ICONS: Record<string, LucideIcon> = {
	rcs: MessageSquareText,
	whatsapp: MessageCircleMore,
	metering: Metronome,
	ai: Bot,
	security: ShieldCheck,
	tests: FlaskConical,
	bug: Bug,
	review: GitPullRequest,
	pricing: CircleDollarSign,
	legal: Scale,
	slides: Presentation,
	sheet: Sheet,
	data: ChartColumn,
	database: Database,
	api: Plug,
	docs: FileText,
	planning: ListChecks,
	email: Mail,
	calendar: CalendarDays,
	design: Palette,
	media: ImageIcon,
	launch: Rocket,
	infra: Server,
	campaign: Megaphone,
	messaging: MessagesSquare,
	customers: Users,
	phone: Smartphone,
	world: Globe,
	link: LinkIcon,
	files: FolderOpen,
	setup: Settings,
	research: Search,
	learn: GraduationCap,
	idea: Lightbulb,
	code: CodeXml,
	general: Sparkles,
};

/**
 * Your own pictures for topics, by topic id: a product's logo in place of the line drawing. The
 * page fills this from the files in the data folder's `logos` folder.
 */
export const TopicLogos = createContext<Record<string, string>>({});

/**
 * The icon a chat shows: the one saved with it (suggested once, or picked by you). A chat saved
 * before icons existed, or still named after its folder, falls back to what its title suggests.
 */
export function topicOf(session: Pick<Session, 'icon' | 'title' | 'titleAuto'>): string {
	if (isTopic(session.icon)) return session.icon;
	return session.titleAuto ? DEFAULT_TOPIC : suggestTopic(session.title);
}

interface GlyphProps {
	topic: string;
	size?: number;
}

/** Just the drawing, for places that only show the icon. */
export function TopicGlyph({ topic, size = 44 }: GlyphProps) {
	const logo = useContext(TopicLogos)[topic];
	if (logo) return <img className="topic-logo" src={logo} alt="" width={size} height={size} />;
	const Icon = ICONS[topic] ?? Sparkles;
	return <Icon size={size} strokeWidth={1.6} aria-hidden="true" focusable={false} />;
}

/** The icon in its tile, in the chat's own colour. Shown as is where it cannot be changed. */
export function TopicTile({ session, small }: { session: Session; small?: boolean }) {
	const topic = topicOf(session);
	return (
		<span className={`topic${small ? ' small' : ''}`} title={topicLabel(topic)}>
			<TopicGlyph topic={topic} size={small ? 22 : 44} />
		</span>
	);
}

interface Props {
	session: Session;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Saves your pick; `null` hands the icon back to the suggestion. */
	onPick: (icon: string | null) => void;
}

/** The icon tile as a button: click it to pick another from the set. */
export function TopicIcon({ session, open, onOpenChange, onPick }: Props) {
	const topic = topicOf(session);
	const wrap = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		if (!open) return;
		const outside = (event: MouseEvent) => {
			if (!wrap.current?.contains(event.target as Node)) onOpenChange(false);
		};
		const escape = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			event.stopPropagation();
			onOpenChange(false);
		};
		document.addEventListener('mousedown', outside);
		document.addEventListener('keydown', escape, true);
		return () => {
			document.removeEventListener('mousedown', outside);
			document.removeEventListener('keydown', escape, true);
		};
	}, [open, onOpenChange]);

	const pick = (icon: string | null) => {
		onOpenChange(false);
		onPick(icon);
	};

	return (
		<span className="topic-wrap" ref={wrap}>
			<button
				type="button"
				className="topic"
				aria-haspopup="dialog"
				aria-expanded={open}
				aria-label={`Change the icon for ${session.title}. Now: ${topicLabel(topic)}`}
				title={`${topicLabel(topic)} · click to change`}
				data-topic={topic}
				onClick={() => onOpenChange(!open)}
			>
				<TopicGlyph topic={topic} />
			</button>
			{open && (
				<div className="icon-picker" role="dialog" aria-label={`Icon for ${session.title}`}>
					<div className="icon-grid">
						{TOPICS.map((option) => (
							<button
								key={option.id}
								type="button"
								className={option.id === topic ? 'on' : undefined}
								aria-label={option.label}
								aria-pressed={option.id === topic}
								title={option.label}
								onClick={() => pick(option.id)}
							>
								<TopicGlyph topic={option.id} size={22} />
							</button>
						))}
					</div>
					<div className="icon-picker-foot">
						<span>
							{session.iconChosen
								? 'You picked this icon.'
								: 'Suggested from the title and first prompt.'}
						</span>
						{session.iconChosen && (
							<button type="button" className="link" onClick={() => pick(null)}>
								Use the suggestion
							</button>
						)}
					</div>
				</div>
			)}
		</span>
	);
}
