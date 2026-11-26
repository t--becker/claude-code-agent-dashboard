interface Props {
	message: string;
	undoLabel?: string;
	onUndo?: () => void;
	onDismiss: () => void;
}

export function Notice({ message, undoLabel = 'Undo close', onUndo, onDismiss }: Props) {
	return (
		<div className="notice">
			<span role="status">{message}</span>
			<div className="notice-actions">
				{onUndo && (
					<button type="button" className="undo" onClick={onUndo}>
						{undoLabel}
					</button>
				)}
				<button type="button" className="dismiss" aria-label="Dismiss" onClick={onDismiss}>
					×
				</button>
			</div>
		</div>
	);
}
