import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FolderPrompt } from './FolderPrompt';

const config = {
	repoRoot: '/Users/me/repo',
	projects: ['alpha', 'beta'],
	anyLive: true,
	folderPicker: false,
	defaultPermissionMode: 'default' as const,
};

describe('FolderPrompt', () => {
	it('asks for nothing but the folder, offers the projects, and starts there', async () => {
		const onStart = vi.fn(async () => undefined);
		const { container } = render(
			<FolderPrompt config={config} onStart={onStart} onCancel={vi.fn()} />
		);
		const form = screen.getByRole('form', { name: 'New agent' });
		expect(form.querySelectorAll('input, select, textarea')).toHaveLength(1);
		const folder = screen.getByLabelText('Project folder');
		expect(folder).toHaveValue('/Users/me/repo/');
		expect(
			[...container.querySelectorAll('datalist option')].map((o) => o.getAttribute('value'))
		).toEqual(['/Users/me/repo/alpha', '/Users/me/repo/beta']);
		await userEvent.type(folder, 'alpha');
		await userEvent.click(screen.getByRole('button', { name: 'Start' }));
		expect(onStart).toHaveBeenCalledWith('/Users/me/repo/alpha');
	});

	it('shows why the folder chooser was not used, and what went wrong when starting', async () => {
		const onStart = vi.fn(async () => {
			throw new Error('Folder not found: /nope');
		});
		render(
			<FolderPrompt
				config={config}
				reason="The folder chooser could not open"
				onStart={onStart}
				onCancel={vi.fn()}
			/>
		);
		expect(screen.getByText('The folder chooser could not open')).toBeInTheDocument();
		await userEvent.click(screen.getByRole('button', { name: 'Start' }));
		expect(await screen.findByText('Folder not found: /nope')).toBeInTheDocument();
	});
});
