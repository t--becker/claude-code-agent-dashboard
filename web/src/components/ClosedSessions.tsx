import type { Session } from '@shared/types';
import { TopicTile } from './TopicIcon';

interface Props {
	sessions: Session[];
	onReopen: (session: Session) => void;
	onRemove: (session: Session) => void;
	/** Each chat's colour, the same one its card had. */
	tones?: Map<string, number>;
}

export function ClosedSessions({ sessions, onReopen, onRemove, tones }: Props) {
	return (
		<section className="archive-panel" aria-label="Closed sessions">
			{sessions.length === 0 ? (
				<p className="meta">
					Nothing closed. A card you close from its menu is kept here, ready to reopen; closing does
					not stop its agent.
				</p>
			) : (
				sessions.map((session) => (
					<div
						key={session.id}
						className={`archive-item tone-${tones?.get(session.id) ?? 0}`}
						data-session-id={session.id}
					>
						<TopicTile session={session} small />
						<div className="archive-name">
							{session.title}
							<small>
								{session.path} · {session.state}
								{session.providerMode === 'demo' ? ' · demo mode' : ''}
							</small>
						</div>
						<div className="archive-actions">
							<button type="button" onClick={() => onReopen(session)}>
								Reopen
							</button>
							<button type="button" className="danger" onClick={() => onRemove(session)}>
								Delete
							</button>
						</div>
					</div>
				))
			)}
		</section>
	);
}
