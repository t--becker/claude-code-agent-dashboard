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

	it('folds to one line and unfolds to a list that opens each thing', async () => {
		render(<OutputsBar outputs={outputs} transcript={transcript} title="Chat" />);
		const toggle = screen.getByRole('button', { name: /Outputs · 4/ });
		expect(toggle).toHaveAttribute('aria-expanded', 'false');
		// Folded, it names what is inside, newest first.
		expect(toggle).toHaveTextContent(
			'Guide · a b.pdf · OPS-12 Fix the status refresh · Code changes'
		);
		expect(screen.queryByRole('list')).toBeNull();

		await userEvent.click(toggle);
		const list = screen.getByRole('list', { name: 'Outputs of Chat' });
		const ticket = within(list).getByRole('link', { name: /OPS-12 Fix the status refresh/ });
		expect(ticket).toHaveAttribute('href', 'https://example.atlassian.net/browse/OPS-12');
		expect(ticket).toHaveAttribute('target', '_blank');
		expect(ticket).toHaveTextContent('Jira ticket · Created');
		expect(within(list).getByRole('link', { name: /a b\.pdf/ })).toHaveAttribute(
			'href',
			'/api/files/work/out/a%20b.pdf'
		);
		// Something with no known address is listed but is not a link.
		expect(within(list).queryByRole('link', { name: /Guide/ })).toBeNull();
		expect(within(list).getByText('Confluence page · Updated')).toBeInTheDocument();

		await userEvent.keyboard('{Escape}');
		expect(screen.queryByRole('list')).toBeNull();
	});

	it('opens the edits behind Code changes, file by file', async () => {
		render(<OutputsBar outputs={outputs} transcript={transcript} title="Chat" />);
		await userEvent.click(screen.getByRole('button', { name: /Outputs · 4/ }));
		await userEvent.click(
			within(screen.getByRole('list')).getByRole('button', { name: /Code changes/ })
		);
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

		// Opening the panel put the list away; Escape closes the panel as well.
		expect(screen.queryByRole('list')).toBeNull();
		await userEvent.click(screen.getByRole('button', { name: /Outputs · 4/ }));
		await userEvent.click(
			within(screen.getByRole('list')).getByRole('button', { name: /Code changes/ })
		);
		expect(screen.getByRole('dialog', { name: 'Code changes' })).toBeInTheDocument();
		await userEvent.keyboard('{Escape}');
		expect(screen.queryByRole('dialog')).toBeNull();
	});
});
