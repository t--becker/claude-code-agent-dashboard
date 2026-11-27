import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChatOutput, TranscriptEntry } from '@shared/types';
import { OutputsBar } from './OutputsBar';

const outputs: ChatOutput[] = [
	{
		key: 'code',
		kind: 'code',
		title: 'Code changes',
		label: '2 files',
		verb: 'View diff',
		files: ['/work/src/app.ts', '/work/src/gone.ts'],
		ts: 1,
	},
	{
		key: 'ticket:OPS-12',
		kind: 'ticket',
		title: 'OPS-12 Fix the status refresh',
		label: 'Jira ticket',
		verb: 'Created',
		url: 'https://example.atlassian.net/browse/OPS-12',
		ts: 2,
	},
	{
		key: 'file:/work/out/a b.pdf',
		kind: 'file',
		title: 'a b.pdf',
		label: 'PDF',
		verb: 'Created',
		file: '/work/out/a b.pdf',
		ts: 3,
	},
	{ key: 'page:1', kind: 'page', title: 'Guide', label: 'Confluence page', verb: 'Updated', ts: 4 },
];

const transcript: TranscriptEntry[] = [
	{
		id: 't1',
		ts: 1,
		kind: 'tool',
		name: 'Edit',
		summary: '/work/src/app.ts',
		diff: "- const title = 'Old';\n+ const title = 'New';",
		output: 'updated',
	},
];

describe('OutputsBar', () => {
	it('shows nothing for a chat that made nothing', () => {
		const { container } = render(<OutputsBar outputs={[]} transcript={[]} title="Chat" />);
		expect(container).toBeEmptyDOMElement();
	});

	it('names the newest outputs on the line as links, and keeps the rest behind "+N more"', async () => {
		render(<OutputsBar outputs={outputs} transcript={transcript} title="Chat" />);
		const bar = screen.getByRole('group', { name: 'Outputs of Chat' });
		// Newest first: the page (no known address, so plain text) and the PDF.
		expect(within(bar).getByText('Guide').closest('.output-link')).toHaveAttribute(
			'title',
			'Confluence page · Updated'
		);
		expect(within(bar).queryByRole('link', { name: /Guide/ })).toBeNull();
		const pdf = within(bar).getByRole('link', { name: /a b\.pdf/ });
		expect(pdf).toHaveAttribute('href', '/api/files/work/out/a%20b.pdf');
		expect(pdf).toHaveAttribute('target', '_blank');
		expect(screen.queryByRole('list')).toBeNull();

		const more = within(bar).getByRole('button', { name: '+2 more' });
		expect(more).toHaveAttribute('aria-expanded', 'false');
		await userEvent.click(more);
		const list = screen.getByRole('list', { name: 'All outputs of Chat' });
		const ticket = within(list).getByRole('link', { name: /OPS-12 Fix the status refresh/ });
		expect(ticket).toHaveAttribute('href', 'https://example.atlassian.net/browse/OPS-12');
		expect(ticket).toHaveTextContent('Jira ticket · Created');
		expect(within(list).getByText('Confluence page · Updated')).toBeInTheDocument();
		await userEvent.keyboard('{Escape}');
		expect(screen.queryByRole('list')).toBeNull();
	});

	it('shows everything on the line when there is little, with the diff one click away', async () => {
		render(<OutputsBar outputs={outputs.slice(0, 2)} transcript={transcript} title="Chat" />);
		const bar = screen.getByRole('group', { name: 'Outputs of Chat' });
		expect(within(bar).queryByRole('button', { name: /more/ })).toBeNull();
		expect(within(bar).getByRole('link', { name: /OPS-12/ })).toBeInTheDocument();

		await userEvent.click(within(bar).getByRole('button', { name: 'View diff (2 files)' }));
		const dialog = screen.getByRole('dialog', { name: 'Code changes' });
		expect(within(dialog).getByText('Code changes · 2 files')).toBeInTheDocument();
		expect(within(dialog).getByText("+ const title = 'New';")).toHaveClass('added');
		expect(within(dialog).getByText("- const title = 'Old';")).toHaveClass('removed');
		// A file whose edits have dropped out of the kept history says so.
		expect(
			within(within(dialog).getByRole('region', { name: '/work/src/gone.ts' })).getByText(
				/no longer in the part of the chat kept here/
			)
		).toBeInTheDocument();
		await userEvent.click(within(dialog).getByRole('button', { name: 'Close code changes' }));
		expect(screen.queryByRole('dialog')).toBeNull();

		// Escape closes it as well.
		await userEvent.click(within(bar).getByRole('button', { name: 'View diff (2 files)' }));
		await userEvent.keyboard('{Escape}');
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('opens the diff from the full list too', async () => {
		render(<OutputsBar outputs={outputs} transcript={transcript} title="Chat" />);
		await userEvent.click(screen.getByRole('button', { name: '+2 more' }));
		await userEvent.click(
			within(screen.getByRole('list')).getByRole('button', { name: /Code changes/ })
		);
		expect(screen.getByRole('dialog', { name: 'Code changes' })).toBeInTheDocument();
		expect(screen.queryByRole('list')).toBeNull();
	});
});
