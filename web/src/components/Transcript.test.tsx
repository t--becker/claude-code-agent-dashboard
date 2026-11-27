import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TranscriptEntry } from '@shared/types';
import { YourPicture } from './icons';
import { DEFAULT_VISIBLE_ENTRIES, Transcript } from './Transcript';

const entries: TranscriptEntry[] = [
	{ id: 'u1', ts: 1, kind: 'user', text: 'Run the tests' },
	{
		id: 't1',
		ts: 2,
		kind: 'tool',
		name: 'Bash',
		summary: 'npm test',
		toolUseId: 'x',
		output: '12 passed',
	},
	{
		id: 't2',
		ts: 3,
		kind: 'tool',
		name: 'Bash',
		summary: 'npm run lint',
		toolUseId: 'y',
		output: 'boom',
		isError: true,
	},
	{ id: 't3', ts: 4, kind: 'tool', name: 'Read', summary: 'src/app.ts' },
	{ id: 'a1', ts: 5, kind: 'assistant', text: 'All **green**.' },
	{ id: 's1', ts: 6, kind: 'system', text: 'Stopped by you.' },
	{ id: 'e1', ts: 7, kind: 'error', text: 'exit 1' },
];

describe('Transcript', () => {
	it('renders entries in order with tool output folded away, and marks the live step while running', async () => {
		render(
			<Transcript entries={entries} running stream="still typ">
				<div>question box</div>
			</Transcript>
		);
		// The conversation in order, with the three steps between the messages as one line.
		const rows = [...document.querySelectorAll('.response > *')].map((el) => el.className);
		expect(rows).toEqual([
			'msg you',
			'steps has-failed',
			'msg agent-msg',
			'note',
			'note error-note',
			'msg agent-msg',
			'',
		]);
		const group = document.querySelector('details.steps')!;
		expect(group).not.toHaveAttribute('open');
		const line = group.querySelector('summary')!;
		expect(line).toHaveTextContent('3 steps');
		expect(line).toHaveTextContent('Bash, Read');
		expect(line).toHaveTextContent('1 failed');
		expect(screen.getByText('green').closest('.msg')).toHaveTextContent(/^Claude/);
		expect(screen.getByText('still typ').closest('.msg')).toHaveTextContent(/^Claude/);
		expect(document.querySelectorAll('.response time')).toHaveLength(5);
		// A step that went fine is folded; a click opens it. One that failed is open already.
		const first = screen.getByText('npm test').closest('details')!;
		expect(first).not.toHaveAttribute('open');
		await userEvent.click(screen.getByText('npm test'));
		expect(first).toHaveAttribute('open');
		const failed = screen.getByText('npm run lint').closest('details')!;
		expect(failed).toHaveClass('failed');
		expect(failed).toHaveAttribute('open');
		expect(screen.getByText('src/app.ts').closest('.step')).toHaveClass('current');
		expect(screen.getByText('green').tagName).toBe('STRONG');
		expect(document.querySelector('.message.streaming')).toHaveTextContent('still typ');
	});

	it('shows what an edit takes out and puts in, opens only the latest step, and names Codex', () => {
		render(
			<Transcript
				running={false}
				provider="codex"
				entries={[
					{
						id: 't9',
						ts: 1,
						kind: 'tool',
						name: 'Edit',
						summary: 'tour.ts',
						toolUseId: 'z',
						diff: "- title: 'Add phone'\n+ title: 'Add test device'",
						output: 'The file was updated.',
					},
					{
						id: 't10',
						ts: 2,
						kind: 'tool',
						name: 'Bash',
						summary: 'npm run build',
						toolUseId: 'w',
						output: Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n'),
					},
					{ id: 'a9', ts: 3, kind: 'assistant', text: 'Done.' },
				]}
			/>
		);
		expect(screen.getByText("- title: 'Add phone'")).toHaveClass('removed');
		expect(screen.getByText("+ title: 'Add test device'")).toHaveClass('added');
		expect(screen.getByText('tour.ts').closest('details')).not.toHaveAttribute('open');
		expect(screen.getByText('npm run build').closest('details')).toHaveAttribute('open');
		expect(screen.getByText('Codex')).toBeInTheDocument();
	});

	it('uses your own picture beside your messages when the workspace has one', () => {
		const mine = [{ id: 'u1', ts: 1, kind: 'user' as const, text: 'Hello' }];
		const { container, rerender } = render(<Transcript entries={mine} running={false} />);
		expect(container.querySelector('.avatar-you img')).toBeNull();
		rerender(
			<YourPicture.Provider value="/api/avatar?v=1">
				<Transcript entries={mine} running={false} />
			</YourPicture.Provider>
		);
		expect(container.querySelector('.avatar-you img')).toHaveAttribute('src', '/api/avatar?v=1');
	});

	it('unfolds the steps in the full view, and names a single step without a plural', () => {
		const one: TranscriptEntry[] = [
			{ id: 'u', ts: 1, kind: 'user', text: 'Check it' },
			{
				id: 't',
				ts: 2,
				kind: 'tool',
				name: 'mcp__tracker__getIssue',
				summary: 'OPS-1',
				output: 'ok',
			},
		];
		render(<Transcript entries={one} running={false} detailed />);
		const group = document.querySelector('details.steps')!;
		expect(group).toHaveAttribute('open');
		// A connected tool is named by what it does, not by its full address.
		expect(group.querySelector('summary')).toHaveTextContent(/^1 stepgetIssue$/);
	});

	it('shows only the tail of a long chat until asked for the rest', async () => {
		const many: TranscriptEntry[] = Array.from(
			{ length: DEFAULT_VISIBLE_ENTRIES + 25 },
			(_, i) => ({
				id: `m${i}`,
				ts: i,
				kind: 'user',
				text: `prompt ${i}`,
			})
		);
		render(<Transcript entries={many} running={false} />);
		expect(screen.queryByText('prompt 0')).toBeNull();
		expect(screen.getByText(`prompt ${many.length - 1}`)).toBeInTheDocument();
		await userEvent.click(screen.getByRole('button', { name: 'Show 25 earlier entries' }));
		expect(screen.getByText('prompt 0')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /earlier entries/ })).toBeNull();
	});

	it('resolves file links in replies against the agent folder', () => {
		render(
			<Transcript
				entries={[{ id: 'a1', ts: 1, kind: 'assistant', text: 'See [the log](out/log.txt)' }]}
				running={false}
				cwd="/Users/me/projects/shop"
			/>
		);
		expect(screen.getByRole('link', { name: 'the log' })).toHaveAttribute(
			'href',
			'/api/files/Users/me/projects/shop/out/log.txt'
		);
	});

	it('marks where the next reply lands while the agent is working and nothing is arriving', () => {
		const { rerender } = render(<Transcript entries={entries} running />);
		expect(screen.getByRole('img', { name: 'Working' })).toHaveClass('thinking');
		rerender(<Transcript entries={entries} running stream="typing" />);
		expect(screen.queryByRole('img', { name: 'Working' })).toBeNull();
		rerender(<Transcript entries={entries} running={false} />);
		expect(screen.queryByRole('img', { name: 'Working' })).toBeNull();
	});

	it('shows the pictures and files sent with a prompt, each opening in a new tab', () => {
		render(
			<Transcript
				running={false}
				entries={[
					{
						id: 'u9',
						ts: 1,
						kind: 'user',
						text: 'What is wrong here?',
						images: ['/Users/me/.agent-workspace/attachments/a b.png'],
						files: [
							{
								path: '/Users/me/.agent-workspace/attachments/s1/1a2b3c4d-Q3 report.pdf',
								name: 'Q3 report.pdf',
							},
						],
					},
				]}
			/>
		);
		const image = screen.getByRole('img', { name: 'Attached image 1' });
		expect(image).toHaveAttribute(
			'src',
			'/api/files/Users/me/.agent-workspace/attachments/a%20b.png'
		);
		expect(image.closest('a')).toHaveAttribute('target', '_blank');
		expect(screen.getByRole('link', { name: 'Q3 report.pdf' })).toHaveAttribute(
			'href',
			'/api/files/Users/me/.agent-workspace/attachments/s1/1a2b3c4d-Q3%20report.pdf'
		);
	});

	it('names the step the agent is on beside the working dots, and how long it has run', () => {
		const { rerender } = render(<Transcript entries={entries} running />);
		expect(screen.getByText('Working')).toHaveClass('working-label');
		rerender(
			<Transcript
				entries={entries}
				running
				activity={{ label: 'Thinking', since: Date.now() - 75_000 }}
			/>
		);
		expect(screen.getByText(/Thinking · 1m 15s/)).toHaveClass('working-label');
		rerender(
			<Transcript
				entries={entries}
				running
				activity={{ label: 'Running Bash', since: Date.now() }}
			/>
		);
		expect(screen.getByText('Running Bash')).toHaveClass('working-label');
	});
});
