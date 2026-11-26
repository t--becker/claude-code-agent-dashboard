import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ArtifactItem } from '@shared/types';
import { ArtifactLibrary, csvCells } from './ArtifactLibrary';

const items: ArtifactItem[] = [
	{
		id: 'page:1',
		kind: 'page',
		title: 'Fallback lab',
		url: 'https://claude.ai/artifact/Lab01',
		file: '/Users/me/projects/lab/index.html',
		updatedAt: Date.UTC(2026, 0, 5),
		chatTitle: 'Fallback testing',
	},
	{
		id: 'page:2',
		kind: 'page',
		title: 'Old page',
		url: 'https://claude.ai/artifact/Old02',
		updatedAt: 3,
	},
	{
		id: 'file:/a.pdf',
		kind: 'pdf',
		title: 'Signups report',
		file: '/Users/me/a b.pdf',
		updatedAt: 2,
	},
	{
		id: 'file:/p.xlsx',
		kind: 'sheet',
		title: 'Pricing comparison',
		file: '/Users/me/p.xlsx',
		updatedAt: 1,
	},
];

describe('ArtifactLibrary', () => {
	it('shows each artifact with its kind, where it lives, a look at it, and where it opens', async () => {
		render(<ArtifactLibrary load={async () => items} />);
		const lab = await screen.findByRole('link', { name: /Fallback lab/ });
		expect(lab).toHaveAttribute('href', 'https://claude.ai/artifact/Lab01');
		expect(lab).toHaveAttribute('target', '_blank');
		expect(lab).toHaveAttribute('title', 'From the chat “Fallback testing”');
		expect(within(lab).getByText(/Web app · on claude.ai/)).toBeInTheDocument();
		// A live look at the page, shut in a sandbox and not clickable into.
		const frame = lab.querySelector('iframe')!;
		expect(frame).toHaveAttribute('src', '/api/files/Users/me/projects/lab/index.html');
		expect(frame).toHaveAttribute('sandbox', 'allow-scripts');

		// A page whose source is gone still lists, with a placeholder.
		expect(
			within(screen.getByRole('link', { name: /Old page/ })).getByText('Published on claude.ai')
		).toBeInTheDocument();
		const pdf = screen.getByRole('link', { name: /Signups report/ });
		expect(pdf).toHaveAttribute('href', '/api/files/Users/me/a%20b.pdf');
		expect(within(pdf).getByText(/PDF · on this computer/)).toBeInTheDocument();
	});

	it('filters by search words and by kind', async () => {
		render(<ArtifactLibrary load={async () => items} />);
		await screen.findByRole('link', { name: /Fallback lab/ });
		expect(screen.getByRole('button', { name: 'All 4' })).toHaveAttribute('aria-pressed', 'true');
		await userEvent.click(screen.getByRole('button', { name: 'Web apps 2' }));
		expect(screen.getAllByRole('link')).toHaveLength(2);
		await userEvent.click(screen.getByRole('button', { name: 'All 4' }));

		// Words match the title, the kind, or the chat it came from.
		await userEvent.type(screen.getByLabelText('Search artifacts'), 'spreadsheet pricing');
		expect(screen.getAllByRole('link')).toHaveLength(1);
		await userEvent.clear(screen.getByLabelText('Search artifacts'));
		await userEvent.type(screen.getByLabelText('Search artifacts'), 'fallback testing');
		expect(screen.getByRole('link', { name: /Fallback lab/ })).toBeInTheDocument();
		await userEvent.clear(screen.getByLabelText('Search artifacts'));
		await userEvent.type(screen.getByLabelText('Search artifacts'), 'nothing like this');
		expect(screen.getByText('No artifact matches that.')).toBeInTheDocument();
	});

	it('says so when there is nothing yet, or when the library cannot be read', async () => {
		const { unmount } = render(<ArtifactLibrary load={async () => []} />);
		expect(await screen.findByText(/Nothing here yet/)).toBeInTheDocument();
		unmount();
		render(
			<ArtifactLibrary
				load={async () => {
					throw new Error('server away');
				}}
			/>
		);
		expect(await screen.findByRole('alert')).toHaveTextContent('server away');
	});

	it('splits CSV lines on commas, except inside quotes', () => {
		expect(csvCells('a,"b, c",d')).toEqual(['a', 'b, c', 'd']);
		expect(csvCells('"say ""hi""",2')).toEqual(['say "hi"', '2']);
	});
});
