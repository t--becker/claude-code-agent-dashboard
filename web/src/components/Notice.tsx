interface Props {
	message: string;
	onDismiss: () => void;
}

export function Notice({ message, onDismiss }: Props) {
	return (
		<div className="notice">
			<span role="status">{message}</span>
			<button type="button" className="dismiss" aria-label="Dismiss" onClick={onDismiss}>
				×
			</button>
		</div>
	);
}
