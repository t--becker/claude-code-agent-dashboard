import { useState, type FormEvent } from 'react';
import type { WorkspaceConfig } from '@shared/types';

interface Props {
	config?: WorkspaceConfig;
	/** Why the folder chooser was not used, when it failed. */
	reason?: string;
	onStart: (path: string) => Promise<void>;
	onCancel: () => void;
}

/**
 * Asks for the project folder as text. Used where the server cannot open the machine's own
 * folder chooser; on macOS, New agent opens that chooser and this never shows.
 */
export function FolderPrompt({ config, reason, onStart, onCancel }: Props) {
	const root = config?.repoRoot ?? '';
	const [folder, setFolder] = useState(root ? `${root}/` : '');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (!folder.trim() || busy) return;
		setBusy(true);
		setError(undefined);
		try {
			await onStart(folder.trim());
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	};

	return (
		<form className="folder-prompt" aria-label="New agent" onSubmit={(event) => void submit(event)}>
			<label>
				Project folder
				<input
					id="new-agent-folder"
					name="folder"
					list="new-agent-folders"
					value={folder}
					autoFocus
					onChange={(event) => setFolder(event.target.value)}
				/>
			</label>
			<datalist id="new-agent-folders">
				{(config?.projects ?? []).map((project) => (
					<option key={project} value={`${root}/${project}`} />
				))}
			</datalist>
			<button type="submit" className="new-agent" disabled={busy || !folder.trim()}>
				Start
			</button>
			<button type="button" className="archive-toggle" onClick={onCancel}>
				Cancel
			</button>
			{(error ?? reason) && <span className="folder-prompt-note">{error ?? reason}</span>}
		</form>
	);
}
