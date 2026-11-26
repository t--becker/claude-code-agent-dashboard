import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PendingInput } from '@shared/types';
import { makeActions, makeSession } from '../tests/fixtures';
import { ReplyBanner } from './ReplyBanner';

const question: PendingInput = {
	id: 'q1',
	kind: 'question',
	title: 'Should I open a pull request or publish the release?',
	options: [
		{ id: 'pr', label: 'Open a PR' },
		{ id: 'publish', label: 'Publish the release' },
	],
	allowFreeText: true,
};

const renderBanner = (input: PendingInput = question) => {
	const actions = makeActions();
	const handlers = { onTogglePin: vi.fn(), onViewChat: vi.fn(), onClose: vi.fn() };
	const session = makeSession({ state: 'Needs input', pendingInput: input });
	render(
		<ReplyBanner session={session} input={input} pinned={false} actions={actions} {...handlers} />
	);
	return { actions, ...handlers };
};

describe('ReplyBanner', () => {
	it('shows the question with its suggested replies and sends the one chosen', async () => {
		const { actions, onViewChat } = renderBanner();
		expect(screen.getByText('Needs your reply')).toBeInTheDocument();
		expect(
			screen.getByRole('group', { name: 'Should I open a pull request or publish the release?' })
		).toBeInTheDocument();
		await userEvent.click(screen.getByRole('button', { name: 'Open a PR' }));
		expect(actions.answer).toHaveBeenCalledWith('session-1', { optionId: 'pr' });
		await userEvent.click(screen.getByRole('button', { name: 'View chat' }));
		expect(onViewChat).toHaveBeenCalled();
	});

	it('sends a typed reply, and can stop or close the agent instead', async () => {
		const { actions, onClose } = renderBanner();
		const send = screen.getByRole('button', { name: 'Send reply' });
		expect(send).toBeDisabled();
		await userEvent.type(screen.getByLabelText('Your answer'), 'Open a PR so I can review');
		await userEvent.click(send);
		expect(actions.answer).toHaveBeenCalledWith('session-1', { text: 'Open a PR so I can review' });
		await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
		expect(actions.stop).toHaveBeenCalledWith('session-1');
		await userEvent.click(screen.getByRole('button', { name: 'Close Storefront help links' }));
		expect(onClose).toHaveBeenCalled();
	});

	it('shows what a permission request would run, without a free-text box', () => {
		renderBanner({
			id: 'p1',
			kind: 'permission',
			title: 'Run a command: Install dependencies',
			detail: 'npm install',
			toolName: 'Bash',
			options: [
				{ id: 'allow', label: 'Allow' },
				{ id: 'deny', label: 'Deny' },
			],
			allowFreeText: false,
		});
		expect(screen.getByText('npm install')).toHaveClass('code');
		expect(screen.getByText('Your call')).toBeInTheDocument();
		expect(screen.queryByLabelText('Your answer')).toBeNull();
	});
});
