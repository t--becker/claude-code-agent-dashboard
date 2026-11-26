import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgentCard } from './AgentCard';
import { TopicLogos } from './TopicIcon';
import { claudeProvider, makeActions, makeSession } from '../tests/fixtures';

const renderCard = (
	overrides: Parameters<typeof makeSession>[0] = {},
	props: Partial<React.ComponentProps<typeof AgentCard>> = {}
) => {
	const actions = makeActions();
	const session = makeSession(overrides);
	const utils = render(
		<AgentCard
			session={session}
			provider={claudeProvider}
			focused={false}
			hidden={false}
			now={Date.now()}
			actions={actions}
			onExpand={vi.fn()}
			onShrink={vi.fn()}
			onClose={vi.fn()}
			{...props}
		/>
	);
	return { ...utils, actions, session };
};

describe('AgentCard', () => {
	beforeEach(() => localStorage.clear());

	it('shows project, folder, branch, tool, model, status and latest output', () => {
		const { container } = renderCard();
		expect(screen.getByRole('heading', { name: 'Storefront help links' })).toBeInTheDocument();
		// The folder is one hover away, on the project line.
		expect(screen.getByText('storefront / feature/help-links').closest('.meta')).toHaveAttribute(
			'title',
			'/Users/me/projects/storefront'
		);
		expect(screen.getByText('Claude Sonnet 5.5', { selector: '.model-tag' })).toHaveAttribute(
			'title',
			'claude-sonnet-5-5'
		);
		expect(container.querySelector('.status')).toHaveTextContent(/^Running$/);
		expect(screen.getByText('I located the help links.')).toBeInTheDocument();
		expect(screen.getByText('Update the help links').closest('.msg')).toHaveClass('you');
		expect(screen.getByText('help-link in src').closest('.step')).toHaveClass('current');
		expect(container.querySelector('.elapsed')).toHaveTextContent(/^\d+s$/);
	});

	it.each(
		Object.entries({
			Running: { state: 'Running', cls: '', control: 'Stop', sendEnabled: false },
			'Needs input': { state: 'Needs input', cls: 'waiting', control: 'Stop', sendEnabled: false },
			Stopped: { state: 'Stopped', cls: 'stopped', control: 'Resume', sendEnabled: true },
			Done: { state: 'Done', cls: 'completed', control: undefined, sendEnabled: true },
			Error: { state: 'Error', cls: 'error', control: undefined, sendEnabled: true },
		} as const)
	)('renders the %s state', async (_name, { state, cls, control, sendEnabled }) => {
		const { container } = renderCard({ state });
		const card = container.querySelector('section.agent')!;
		expect(card).toHaveAttribute('data-state', state);
		if (cls) expect(card).toHaveClass(cls);
		expect(card.querySelector('.status')).toHaveTextContent(state);
		expect(card.querySelector('.thinking') !== null).toBe(state === 'Running');
		if (control) expect(screen.getByRole('button', { name: control })).toBeInTheDocument();
		else expect(screen.queryByRole('button', { name: /Stop|Resume/ })).toBeNull();
		await userEvent.type(screen.getByLabelText('Prompt Storefront help links'), 'next step');
		const send = screen.getByRole('button', { name: 'Send' });
		if (sendEnabled) expect(send).toBeEnabled();
		else expect(send).toBeDisabled();
	});

	it('labels demo sessions and keeps the stop control separate from close', async () => {
		const onClose = vi.fn();
		const { actions } = renderCard({ providerMode: 'demo' }, { onClose });
		expect(screen.getByText('Demo mode')).toBeInTheDocument();
		await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
		expect(actions.stop).toHaveBeenCalledWith('session-1');
		expect(onClose).not.toHaveBeenCalled();
		// Closing is in the card's menu, away from the controls used all the time.
		await userEvent.click(screen.getByRole('button', { name: 'More for Storefront help links' }));
		await userEvent.click(screen.getByRole('menuitem', { name: 'Close' }));
		expect(onClose).toHaveBeenCalled();
		expect(screen.queryByRole('menu')).toBeNull();
	});

	it('sends a prompt, clears the draft and persists drafts while typing', async () => {
		const { actions } = renderCard({ state: 'Done' });
		const box = screen.getByLabelText('Prompt Storefront help links');
		await userEvent.type(box, 'Check the links');
		expect(JSON.parse(localStorage.getItem('agent-workspace:ui')!).drafts['session-1']).toBe(
			'Check the links'
		);
		await userEvent.click(screen.getByRole('button', { name: 'Send' }));
		expect(actions.prompt).toHaveBeenCalledWith('session-1', 'Check the links');
		expect(box).toHaveValue('');
	});

	it('sends on Enter and keeps Shift+Enter as a line break', async () => {
		const { actions } = renderCard({ state: 'Done' });
		const box = screen.getByLabelText('Prompt Storefront help links');
		await userEvent.type(box, 'line one{Shift>}{Enter}{/Shift}line two');
		expect(box).toHaveValue('line one\nline two');
		expect(actions.prompt).not.toHaveBeenCalled();
		await userEvent.type(box, '{Enter}');
		expect(actions.prompt).toHaveBeenCalledWith('session-1', 'line one\nline two');
	});

	it('restores a saved draft on mount', () => {
		localStorage.setItem(
			'agent-workspace:ui',
			JSON.stringify({ drafts: { 'session-1': 'saved draft' } })
		);
		renderCard();
		expect(screen.getByLabelText('Prompt Storefront help links')).toHaveValue('saved draft');
	});

	it('queues a model change for the next prompt from the expanded settings', async () => {
		const { actions, rerender, session } = renderCard({}, { focused: true });
		await userEvent.selectOptions(
			screen.getByLabelText('Model for the next prompt'),
			'claude-opus-5-5'
		);
		expect(actions.setModel).toHaveBeenCalledWith('session-1', 'claude-opus-5-5');
		rerender(
			<AgentCard
				session={{ ...session, nextModel: 'claude-opus-5-5' }}
				provider={claudeProvider}
				focused
				hidden={false}
				now={Date.now()}
				actions={actions}
				onExpand={vi.fn()}
				onShrink={vi.fn()}
				onClose={vi.fn()}
			/>
		);
		expect(
			screen.getByText('Next prompt: Claude Opus 5.5. Current run stays on Claude Sonnet 5.5.')
		).toBeInTheDocument();
		expect(screen.getByText('Claude Sonnet 5.5', { selector: '.model-tag' })).toBeInTheDocument();
	});

	it('shows a pending question and sends the chosen option', async () => {
		const { actions } = renderCard({
			state: 'Needs input',
			pendingInput: {
				id: 'p1',
				kind: 'permission',
				title: 'Allow Bash?',
				detail: 'npm test',
				toolName: 'Bash',
				options: [
					{ id: 'allow', label: 'Allow' },
					{ id: 'deny', label: 'Deny' },
				],
				allowFreeText: false,
			},
		});
		const box = screen.getByRole('group', { name: 'Allow Bash?' });
		expect(within(box).getByText('npm test')).toBeInTheDocument();
		expect(within(box).getByText('Claude Code needs your permission')).toBeInTheDocument();
		expect(within(box).getByText(/changes files in storefront/)).toBeInTheDocument();
		await userEvent.click(within(box).getByRole('button', { name: 'Allow' }));
		expect(actions.answer).toHaveBeenCalledWith('session-1', { optionId: 'allow' });
	});

	it('shows a mirrored chat as running while its own window is busy, without taking over its controls', () => {
		const external = {
			sessionId: 'abc',
			lastModified: Date.now(),
			active: true,
			messageCount: 2,
			open: { pid: 7, status: 'busy', statusSince: Date.now() - 65_000, client: 'VS Code' },
		};
		const transcript = [
			{ id: 'u1', ts: 1, kind: 'user' as const, text: 'Run the tests' },
			{ id: 't1', ts: 2, kind: 'tool' as const, name: 'Bash', summary: 'npm test', toolUseId: 'x' },
		];
		const { container, rerender, session } = renderCard({ state: 'Done', external, transcript });
		const card = container.querySelector('section.agent')!;
		expect(card).toHaveAttribute('data-state', 'Running');
		expect(container.querySelector('.status')).toHaveTextContent(/^Running$/);
		expect(container.querySelector('.elapsed')).toHaveTextContent(/^1m 5s$/);
		expect(screen.getByText(/Running Bash in VS Code · 1m 5s/)).toHaveClass('working-label');
		expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();

		rerender(
			<AgentCard
				session={{
					...session,
					external: { ...external, open: { ...external.open, status: 'idle' } },
				}}
				provider={claudeProvider}
				focused={false}
				hidden={false}
				now={Date.now()}
				actions={makeActions()}
				onExpand={vi.fn()}
				onShrink={vi.fn()}
				onClose={vi.fn()}
			/>
		);
		expect(card).toHaveAttribute('data-state', 'Done');
		expect(container.querySelector('.working-label')).toBeNull();
	});

	it('renames the chat in place: Enter saves, Escape leaves it alone', async () => {
		const { actions } = renderCard();
		await userEvent.click(screen.getByRole('button', { name: 'More for Storefront help links' }));
		await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
		const input = screen.getByLabelText('Chat title');
		expect(input).toHaveValue('Storefront help links');
		await userEvent.clear(input);
		await userEvent.type(input, 'Pricing review{Enter}');
		expect(actions.rename).toHaveBeenCalledWith('session-1', 'Pricing review');
		expect(screen.queryByLabelText('Chat title')).toBeNull();

		await userEvent.dblClick(screen.getByRole('heading', { name: 'Storefront help links' }));
		await userEvent.type(screen.getByLabelText('Chat title'), ' extra{Escape}');
		expect(actions.rename).toHaveBeenCalledTimes(1);
	});

	it('attaches pasted and chosen files of any type, lets one be removed, and sends them with the prompt', async () => {
		const { actions } = renderCard({ state: 'Done' });
		const shot = new File([new Uint8Array([137, 80, 78, 71])], 'shot.png', { type: 'image/png' });
		const photo = new File([new Uint8Array([255, 216, 255])], 'photo.jpg', { type: 'image/jpeg' });
		const notes = new File(['hello'], 'notes.txt', { type: 'text/plain' });
		const prompt = screen.getByLabelText('Prompt Storefront help links');

		await userEvent.click(prompt);
		await userEvent.paste({ files: [shot], types: ['Files'] } as unknown as DataTransfer);
		expect(await screen.findByRole('img', { name: 'shot.png' })).toBeInTheDocument();

		await userEvent.upload(screen.getByLabelText('Attach files to Storefront help links'), [
			photo,
			notes,
		]);
		expect(await screen.findByRole('img', { name: 'photo.jpg' })).toBeInTheDocument();
		// Anything that is not a picture shows as a named chip with its size.
		expect(screen.getByText('notes.txt')).toBeInTheDocument();
		expect(screen.getByText('5 B')).toBeInTheDocument();

		await userEvent.click(screen.getByRole('button', { name: 'Remove photo.jpg' }));
		expect(screen.queryByRole('img', { name: 'photo.jpg' })).toBeNull();

		// Files alone can be sent.
		const send = screen.getByRole('button', { name: 'Send' });
		expect(send).toBeEnabled();
		await userEvent.click(send);
		expect(actions.prompt).toHaveBeenCalledWith('session-1', '', [
			{ name: 'shot.png', mediaType: 'image/png', data: 'iVBORw==' },
			{ name: 'notes.txt', mediaType: 'text/plain', data: 'aGVsbG8=' },
		]);
		await vi.waitFor(() => expect(screen.queryByRole('img', { name: 'shot.png' })).toBeNull());
	});

	it('shows a card that was just created as ready, with the cursor in its prompt', () => {
		const { container } = renderCard(
			{ state: 'Done', turns: 0, transcript: [] },
			{ autoFocusPrompt: true }
		);
		expect(container.querySelector('.status')).toHaveTextContent(/^Ready$/);
		expect(screen.getByText(/Type the first prompt below/)).toBeInTheDocument();
		expect(screen.getByLabelText('Prompt Storefront help links')).toHaveFocus();
	});

	it('shows a topic icon beside the title and lets you pick another, or go back to the suggestion', async () => {
		const { actions, container } = renderCard({ state: 'Done', icon: 'messaging' });
		const tile = screen.getByRole('button', {
			name: 'Change the icon for Storefront help links. Now: Messaging',
		});
		expect(tile).toHaveAttribute('data-topic', 'messaging');
		// The tile sits between the status and the title.
		expect(tile.closest('.topic-wrap')!.nextElementSibling).toHaveClass('head-title');
		expect(screen.queryByRole('dialog')).toBeNull();

		await userEvent.click(tile);
		const picker = screen.getByRole('dialog', { name: 'Icon for Storefront help links' });
		expect(within(picker).getByRole('button', { name: 'Messaging' })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		expect(within(picker).getByText('Suggested from the title and first prompt.')).toBeVisible();
		// The card cannot be dragged away while the picker is open.
		expect(container.querySelector('.agent-head')).toHaveAttribute('draggable', 'false');
		await userEvent.click(within(picker).getByRole('button', { name: 'Pricing and billing' }));
		expect(actions.setIcon).toHaveBeenCalledWith('session-1', 'pricing');
		expect(screen.queryByRole('dialog')).toBeNull();

		await userEvent.click(tile);
		await userEvent.keyboard('{Escape}');
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('shows your own logo for a topic when the workspace has one', () => {
		const { container } = render(
			<TopicLogos.Provider value={{ rcs: '/api/logos/rcs?v=1' }}>
				<AgentCard
					session={makeSession({ state: 'Done', icon: 'rcs' })}
					provider={claudeProvider}
					focused={false}
					hidden={false}
					now={Date.now()}
					actions={makeActions()}
					onExpand={vi.fn()}
					onShrink={vi.fn()}
					onClose={vi.fn()}
				/>
			</TopicLogos.Provider>
		);
		expect(container.querySelector('button.topic img')).toHaveAttribute(
			'src',
			'/api/logos/rcs?v=1'
		);
	});

	it('offers the suggestion back once you have picked an icon, and guesses one for older chats', async () => {
		const { actions } = renderCard({ state: 'Done', icon: 'launch', iconChosen: true });
		await userEvent.click(screen.getByRole('button', { name: /Now: Release/ }));
		expect(screen.getByText('You picked this icon.')).toBeVisible();
		await userEvent.click(screen.getByRole('button', { name: 'Use the suggestion' }));
		expect(actions.setIcon).toHaveBeenCalledWith('session-1', null);
	});

	it('pins and opens the full view from the menu, and opens it from the message box too', async () => {
		const onTogglePin = vi.fn();
		const onExpand = vi.fn();
		renderCard({ state: 'Done' }, { onTogglePin, onExpand });
		const more = screen.getByRole('button', { name: 'More for Storefront help links' });
		await userEvent.click(more);
		await userEvent.click(screen.getByRole('menuitem', { name: 'Pin to the front' }));
		expect(onTogglePin).toHaveBeenCalledTimes(1);
		await userEvent.click(more);
		await userEvent.click(screen.getByRole('menuitem', { name: 'Open chat' }));
		await userEvent.click(screen.getByRole('button', { name: 'Expand Storefront help links' }));
		expect(onExpand).toHaveBeenCalledTimes(2);
	});

	it('changes permissions for the next prompt from the expanded settings', async () => {
		const { actions } = renderCard({}, { focused: true });
		const select = screen.getByLabelText('Permissions for the next prompt');
		expect(select).toHaveValue('default');
		await userEvent.selectOptions(select, 'bypassPermissions');
		expect(actions.setPermissionMode).toHaveBeenCalledWith('session-1', 'bypassPermissions');
	});
});
