import os from 'node:os';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

// Same folder as playwright.config.ts gives the server.
const repoRoot = path.join(os.tmpdir(), 'agent-workspace-e2e-repos');

/**
 * New agent asks only for the folder. The card opens named after it, ready for a prompt; the
 * test then gives it a name of its own and sends the first prompt.
 */
/** An agent on the page: its card, or its banner while it waits for a reply. */
const CARD = 'section[data-session-id]';
const SEND = { name: 'Send', exact: true } as const;

/** Picks something from a card's "…" menu. */
async function fromMenu(card: Locator, item: string) {
	await card.getByRole('button', { name: /^More for / }).click();
	await card.getByRole('menuitem', { name: item, exact: true }).click();
}

async function createAgent(page: Page, name: string, prompt: string, project = 'alpha') {
	await page.getByRole('button', { name: 'New agent', exact: true }).click();
	const form = page.getByRole('form', { name: 'New agent' });
	await form.getByLabel('Project folder').fill(`${repoRoot}/${project}`);
	await form.getByRole('button', { name: 'Start' }).click();
	await expect(form).toBeHidden();

	const fresh = page.locator(CARD, {
		has: page.getByRole('heading', { name: project, exact: true }),
	});
	await expect(fresh.locator('.status')).toHaveText('Ready');
	await expect(fresh.getByLabel(`Prompt ${project}`)).toBeFocused();
	// The heading gives way to a text box while renaming, so hold the card by its id.
	const id = await fresh.getAttribute('data-session-id');
	const card = page.locator(`section[data-session-id="${id}"]`);
	await fromMenu(card, 'Rename');
	await card.getByLabel('Chat title').fill(name);
	await card.getByLabel('Chat title').press('Enter');

	await expect(card.getByRole('heading', { name, exact: true })).toBeVisible();
	await card.getByLabel(`Prompt ${name}`).fill(prompt);
	await card.getByLabel(`Prompt ${name}`).press('Enter');
	return card;
}

/** Sends a prompt and waits for the turn to be recorded, so a later "Done" check cannot pass against the previous state. */
async function sendPrompt(card: Locator, label: string, text: string) {
	const turns = await card.locator('.response .you').count();
	await card.getByLabel(label).fill(text);
	await card.getByRole('button', SEND).click();
	await expect(card.locator('.response .you')).toHaveCount(turns + 1);
}
const expectState = (card: Locator, state: string) =>
	expect(card).toHaveAttribute('data-state', state, { timeout: 15_000 });
const live = (page: Page) => expect(page.locator('.live.on')).toHaveText('Live');

test.beforeEach(async ({ page }) => {
	await page.goto('/');
	await live(page);
});

test('creates an agent card with the project, folder, tool, model and demo label, and runs it to Done', async ({
	page,
}) => {
	const card = await createAgent(page, 'Onboarding links', 'Update the RCS help links');
	await expect(card.locator('.meta')).toHaveText('alpha / no git');
	await expect(card.locator('.meta')).toHaveAttribute('title', `${repoRoot}/alpha`);
	await expect(card.locator('.model-tag')).toHaveText('Claude Fable 5.1');
	await expect(card.locator('.engine-tag.demo-tag')).toHaveText('Demo mode');
	await expect(page.getByRole('button', { name: 'Running 1', exact: true })).toBeVisible();

	await expectState(card, 'Done');
	await expect(card.locator('.response .message').last()).toContainText(
		'Demo mode: Claude Code is not connected'
	);
	await expect(card.locator('.response .you .bubble')).toHaveText('Update the RCS help links');
	// Two finished now: this one and the long sample chat the suite starts with.
	await expect(page.getByRole('button', { name: 'Done 2', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Running 0', exact: true })).toBeVisible();
	await expect(page.locator('.demo')).toContainText(
		'Claude Code: demo mode (demo mode forced by FORCE_DEMO)'
	);
});

test('prompts an existing agent from its own composer', async ({ page }) => {
	const card = page.locator(CARD, { hasText: 'Onboarding links' });
	await card.getByLabel('Prompt Onboarding links').fill('Now check the destinations');
	await card.getByRole('button', SEND).click();
	await expectState(card, 'Running');
	await expect(card.getByRole('button', SEND)).toBeDisabled();
	await expectState(card, 'Done');
	await expect(card.locator('.response .you .bubble').nth(1)).toHaveText(
		'Now check the destinations'
	);
	await expect(card.getByLabel('Prompt Onboarding links')).toHaveValue('');
});

test('expands into a focused view and shrinks back without losing the draft, history or scroll position', async ({
	page,
}) => {
	const card = page.locator(CARD, { hasText: 'Onboarding links' });
	const other = await createAgent(page, 'Dashboard', 'Compare delivery times', 'beta');
	await expectState(other, 'Done');
	// Enough turns to make the card's output scroll.
	for (const text of ['third turn', 'fourth turn', 'fifth turn']) {
		await sendPrompt(card, 'Prompt Onboarding links', text);
		await expectState(card, 'Done');
	}
	const historyCount = await card
		.locator('.response .msg, .response .step, .response .note')
		.count();
	await card.getByLabel('Prompt Onboarding links').fill('unsent draft');
	const output = card.locator('.output');
	// Scroll back the way a person does, with the wheel: up to the top, then a little way down.
	await output.hover();
	await page.mouse.wheel(0, -100000);
	await expect.poll(() => output.evaluate((el) => el.scrollTop)).toBe(0);
	await page.mouse.wheel(0, 60);
	await expect.poll(() => output.evaluate((el) => el.scrollTop)).toBeGreaterThan(20);
	const place = await output.evaluate((el) => el.scrollTop);

	await fromMenu(card, 'Open chat');
	await expect(page.locator('.grid')).toHaveClass(/focused/);
	await expect(card).toHaveClass(/selected/);
	await expect(other).toBeHidden();
	await expect(card.getByLabel('Model for the next prompt')).toBeVisible();
	await expect(page.getByRole('button', { name: '← All agents' })).toBeVisible();
	await expect(card.getByLabel('Prompt Onboarding links')).toHaveValue('unsent draft');
	await expect(card.locator('.response .msg, .response .step, .response .note')).toHaveCount(
		historyCount
	);
	await expect.poll(() => output.evaluate((el) => el.scrollTop)).toBe(place);

	await card.getByRole('button', { name: 'Shrink Onboarding links' }).click();
	await expect(page.locator('.grid')).not.toHaveClass(/focused/);
	await expect(other).toBeVisible();
	await expect(card.getByLabel('Prompt Onboarding links')).toHaveValue('unsent draft');
	await expect(card.locator('.response .msg, .response .step, .response .note')).toHaveCount(
		historyCount
	);
	await expect.poll(() => output.evaluate((el) => el.scrollTop)).toBe(place);

	await fromMenu(card, 'Open chat');
	await page.keyboard.press('Escape');
	await expect(page.locator('.grid')).not.toHaveClass(/focused/);
	await card.getByLabel('Prompt Onboarding links').fill('');
});

test('a model change in the expanded view applies to the next prompt, not the current run', async ({
	page,
}) => {
	const card = page.locator(CARD, { hasText: 'Dashboard' });
	await fromMenu(card, 'Open chat');
	await card.getByLabel('Model for the next prompt').selectOption('claude-opus-5-5');
	await expect(card.locator('.model-note')).toHaveText(
		'Next prompt: Claude Opus 5.5. Current run stays on Claude Fable 5.1.'
	);
	await expect(card.locator('.model-tag')).toHaveText('Claude Fable 5.1');

	await sendPrompt(card, 'Prompt Dashboard', 'Add country labels');
	await expect(card.locator('.model-tag')).toHaveText('Claude Opus 5.5');
	await expect(card.locator('.response')).toContainText('Model changed to Claude Opus 5.5.');
	await expect(card.locator('.model-note')).toHaveText('Using Claude Opus 5.5.');
	await expectState(card, 'Done');
	await page.getByRole('button', { name: '← All agents' }).click();
});

test('pauses for input, then stop and resume are separate from closing', async ({ page }) => {
	const card = await createAgent(page, 'Decision maker', 'Please decide the layout', 'beta');
	await expectState(card, 'Needs input');
	await expect(card).toHaveClass(/waiting/);
	const question = card.getByRole('group', {
		name: 'Should this change include the extended option, or stay minimal?',
	});
	await expect(question).toBeVisible();
	// A waiting agent is a banner above the cards, with its question and the answers on offer.
	await expect(card).toHaveClass(/reply-banner/);
	await expect(card.getByText('Needs your reply')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Needs reply 1', exact: true })).toBeVisible();

	await card.getByRole('button', { name: 'Stop' }).click();
	await expectState(card, 'Stopped');
	await expect(question).toBeHidden();
	await expect(card.locator('.response')).toContainText('Stopped by you.');
	await expect(card).toBeVisible();

	await card.getByRole('button', { name: 'Resume' }).click();
	await expectState(card, 'Running');
	await expect(card.locator('.response .you .bubble').last()).toHaveText(
		'Continue from where you stopped.'
	);
	await expectState(card, 'Done');
});

test('answers a pending question and surfaces a failed turn as Error', async ({ page }) => {
	const card = page.locator(CARD, { hasText: 'Decision maker' });
	await sendPrompt(card, 'Prompt Decision maker', 'decide again');
	await expectState(card, 'Needs input');
	await card.getByRole('button', { name: 'Keep it minimal' }).click();
	await expectState(card, 'Done');
	await expect(card.locator('.response .message').last()).toContainText('You chose: minimal');
	await expect(card.locator('.response')).toContainText('You answered: Keep it minimal');

	await sendPrompt(card, 'Prompt Decision maker', 'please fail');
	await expectState(card, 'Error');
	await expect(card).toHaveClass(/error/);
	await expect(card.locator('.response')).toContainText(
		'Error: Demo failure requested by the prompt.'
	);
	await expect(card.getByRole('button', SEND)).toBeDisabled();
	await card.getByLabel('Prompt Decision maker').fill('x');
	await expect(card.getByRole('button', SEND)).toBeEnabled();
	await card.getByLabel('Prompt Decision maker').fill('');
});

test('closing takes a running session off the page and under Closed without stopping it; reopening brings it back', async ({
	page,
}) => {
	const card = await createAgent(page, 'Background worker', 'decide something slowly', 'alpha');
	await expectState(card, 'Needs input');
	await card.getByRole('button', { name: 'Close Background worker' }).click();
	await expect(card).toBeHidden();
	// It goes quietly: no notice, no undo.
	await expect(page.locator('.notice')).toHaveCount(0);
	// The Closed chip sits after Running and Done, and counts it.
	const closedChip = page.getByRole('button', { name: /^Closed \d+$/ });
	await expect(closedChip).toHaveText('Closed 1');
	await expect(page.locator('.chips .chip').last()).toHaveText('Closed 1');

	// The chip shows what is closed, in place of the agents.
	await closedChip.click();
	await expect(page.locator('section.agent:visible')).toHaveCount(0);
	const archived = page.locator('.archive-item', { hasText: 'Background worker' });
	await expect(archived).toContainText('Needs input');
	await archived.getByRole('button', { name: 'Reopen' }).click();
	await expect(card).toBeVisible();
	await card.getByRole('button', { name: 'Include the extended option' }).click();
	await expectState(card, 'Done');
	// Reopening went back to the agents on its own.
	await expect(page.getByRole('button', { name: /^All \d+$/ })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(closedChip).toHaveText('Closed 0');
});

test('sessions, focus, drafts and closed sessions survive a reload', async ({ page }) => {
	const dashboard = page.locator(CARD, { hasText: 'Dashboard' });
	await fromMenu(dashboard, 'Close');
	const card = page.locator(CARD, { hasText: 'Decision maker' });
	await fromMenu(card, 'Open chat');
	await card.getByLabel('Prompt Decision maker').fill('draft that must survive');

	await page.reload();
	await live(page);
	await expect(page.locator('.grid')).toHaveClass(/focused/);
	await expect(card).toHaveClass(/selected/);
	await expect(card.getByLabel('Prompt Decision maker')).toHaveValue('draft that must survive');
	await expect(card.locator('.response')).toContainText('You answered: Keep it minimal');
	await expect(page.locator('section.agent')).toHaveCount(4);
	await page.getByRole('button', { name: '← All agents' }).click();
	await expect(page.getByRole('button', { name: 'Closed 1', exact: true })).toBeVisible();
	await expect(page.locator('section.agent:visible')).toHaveCount(4);
});

test('sending a prompt jumps to the latest message, even after scrolling back through the history', async ({
	page,
}) => {
	const card = page.locator(CARD, { hasText: 'Onboarding links' });
	const output = card.locator('.output');
	const fromEnd = () => output.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
	await output.hover();
	await page.mouse.wheel(0, -100000);
	await expect.poll(fromEnd).toBeGreaterThan(100);

	await card.getByLabel('Prompt Onboarding links').fill('one more turn');
	await card.getByLabel('Prompt Onboarding links').press('Enter');
	await expect(card.locator('.response .you .bubble').last()).toHaveText('one more turn');
	await expect.poll(fromEnd).toBeLessThan(40);
	await expectState(card, 'Done');
	// The reply that arrived afterwards was followed too.
	await expect.poll(fromEnd).toBeLessThan(40);
});

test('one control sets the permission mode on every card and on cards created later', async ({
	page,
}) => {
	const modes = async () => {
		const body = (await (await page.request.get('/api/bootstrap')).json()) as {
			sessions: { permissionMode: string }[];
		};
		return [...new Set(body.sessions.map((s) => s.permissionMode))];
	};
	expect(await modes()).toEqual(['default']);
	await page.getByLabel('Permissions for all agents').selectOption('bypassPermissions');
	await expect(page.getByText(/without asking you first/)).toBeVisible();
	await expect.poll(modes).toEqual(['bypassPermissions']);

	await page.reload();
	await expect(page.getByLabel('Permissions for all agents')).toHaveValue('bypassPermissions');
	const card = await createAgent(page, 'Later agent', 'Anything');
	await expectState(card, 'Done');
	expect(await modes()).toEqual(['bypassPermissions']);
});

test('a new agent left unnamed takes its name from the first prompt', async ({ page }) => {
	await page.getByRole('button', { name: 'New agent', exact: true }).click();
	const form = page.getByRole('form', { name: 'New agent' });
	await form.getByLabel('Project folder').fill(`${repoRoot}/beta`);
	await form.getByRole('button', { name: 'Start' }).click();
	const fresh = page.locator(CARD, {
		has: page.getByRole('heading', { name: 'beta', exact: true }),
	});
	await fresh.getByLabel('Prompt beta').fill('Summarise the release notes');
	await fresh.getByLabel('Prompt beta').press('Enter');
	const card = page.locator(CARD, { hasText: 'Summarise the release notes' });
	await expect(card.getByRole('heading', { name: 'Summarise the release notes' })).toBeVisible();
	await expectState(card, 'Done');
});

test('an image and a file attached to a prompt are sent to the agent and shown on the prompt', async ({
	page,
}) => {
	const card = page.locator(CARD, { hasText: 'Onboarding links' });
	// The smallest valid PNG: one transparent pixel.
	const pixel = Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
		'base64'
	);
	await card.getByLabel('Attach files to Onboarding links').setInputFiles([
		{ name: 'pixel.png', mimeType: 'image/png', buffer: pixel },
		{ name: 'rates.csv', mimeType: 'text/csv', buffer: Buffer.from('country,rate\nAU,0.049\n') },
	]);
	await expect(card.getByRole('img', { name: 'pixel.png' })).toBeVisible();
	await expect(card.locator('.file-chip')).toContainText('rates.csv');

	await card.getByLabel('Prompt Onboarding links').fill('What is in this picture?');
	await card.getByRole('button', SEND).click();
	const sent = card.locator('.response .you').last();
	await expect(sent).toContainText('What is in this picture?');
	const shown = sent.getByRole('img', { name: 'Attached image 1' });
	await expect(shown).toBeVisible();
	// The saved copy really loads from the server.
	await expect.poll(() => shown.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1);
	await expect(card.locator('.attachment')).toHaveCount(0);
	await expectState(card, 'Done');
	await expect(card.locator('.response .message').last()).toContainText(
		'I received 1 attached image and 1 attached file'
	);
	// The saved file opens from the server with what was attached.
	const link = sent.getByRole('link', { name: 'rates.csv' });
	const saved = await page.request.get(String(await link.getAttribute('href')));
	expect(await saved.text()).toContain('AU,0.049');
});

test('dragging a card by its header onto another reorders them, and the order survives a reload', async ({
	page,
}) => {
	// Tall enough to show both cards at once: a drag cannot start on a card that is off screen.
	await page.setViewportSize({ width: 1280, height: 2400 });
	const titles = () => page.locator('section.agent h3').allTextContents();
	const before = await titles();
	expect(before.length).toBeGreaterThan(2);
	const first = page.locator('section.agent').nth(0);
	const third = page.locator('section.agent').nth(2);
	await third.locator('.agent-head').dragTo(first.locator('.agent-head'));
	const expected = [before[2], before[0], before[1], ...before.slice(3)];
	await expect.poll(titles).toEqual(expected);

	await page.reload();
	await live(page);
	await expect.poll(titles).toEqual(expected);
});

test('finished agents stay on the page with running ones, the chips filter it, and a pinned agent leads', async ({
	page,
}) => {
	// Everything finished before the page opened, and every card is still there to work on.
	const total = await page.locator('section.agent').count();
	expect(total).toBeGreaterThan(3);
	await expect(page.locator('section.agent:visible')).toHaveCount(total);
	await expect(page.getByRole('button', { name: /Finished sessions/ })).toHaveCount(0);

	await page.getByRole('button', { name: /^Running \d+$/ }).click();
	await expect(page.locator('section.agent:visible')).toHaveCount(0);
	await expect(page.getByText('No agents match this filter.')).toBeVisible();
	await page.getByRole('button', { name: /^Done \d+$/ }).click();
	await expect(page.locator('section.agent:visible')).toHaveCount(total);
	await page.getByRole('button', { name: /^All \d+$/ }).click();

	// A card keeps its place when its agent starts and when it finishes.
	const titles = () => page.locator('section.agent h3').allTextContents();
	const before = await titles();
	const other = page.locator(CARD, { hasText: 'Later agent' });
	await other.getByLabel('Prompt Later agent').fill('one more');
	await other.getByLabel('Prompt Later agent').press('Enter');
	await expectState(other, 'Running');
	expect(await titles()).toEqual(before);
	await expect(other.getByLabel('Prompt Later agent')).toBeFocused();
	await expectState(other, 'Done');
	expect(await titles()).toEqual(before);

	// Pinning brings a card to the front, and it stays there after a reload.
	const last = before.at(-1)!;
	const card = page.locator(CARD, { hasText: last });
	await fromMenu(card, 'Pin to the front');
	await expect(page.locator('section.agent h3').first()).toHaveText(last);
	await page.reload();
	await live(page);
	await expect(page.locator('section.agent h3').first()).toHaveText(last);
	await card.getByRole('button', { name: `Unpin ${last}` }).click();
	await expect.poll(titles).toEqual(before);
});

test('a chat gets a topic icon from its first prompt, keeps the one you pick, and shows it everywhere', async ({
	page,
}) => {
	await page.getByRole('button', { name: 'New agent', exact: true }).click();
	const form = page.getByRole('form', { name: 'New agent' });
	await form.getByLabel('Project folder').fill(`${repoRoot}/alpha`);
	await form.getByRole('button', { name: 'Start' }).click();
	const fresh = page.locator(CARD, {
		has: page.getByRole('heading', { name: 'alpha', exact: true }),
	});
	const id = await fresh.getAttribute('data-session-id');
	const card = page.locator(`section[data-session-id="${id}"]`);
	const tile = card.locator('button.topic');
	// Named after its folder, a chat has nothing to suggest an icon from yet.
	await expect(tile).toHaveAttribute('data-topic', 'general');

	await card.getByLabel('Prompt alpha').fill('Check the metronome credit calculation');
	await card.getByLabel('Prompt alpha').press('Enter');
	await expect(tile).toHaveAttribute('data-topic', 'metering');
	await expectState(card, 'Done');

	// Pick another, in the chat's own colour; it stays through more prompts and a rename.
	await tile.click();
	await card
		.getByRole('dialog', { name: /^Icon for/ })
		.getByRole('button', { name: 'Release' })
		.click();
	await expect(tile).toHaveAttribute('data-topic', 'launch');
	await card.getByLabel(/^Prompt /).fill('Now review the pricing docs');
	await card.getByLabel(/^Prompt /).press('Enter');
	await expectState(card, 'Running');
	await expectState(card, 'Done');
	await card.getByRole('heading').dblclick();
	await card.getByLabel('Chat title').fill('Credit maths');
	await card.getByLabel('Chat title').press('Enter');
	await expect(tile).toHaveAttribute('data-topic', 'launch');
	const colour = await tile.evaluate((el) => getComputedStyle(el).borderTopColor);

	// The same icon in the full view, after a reload, and on the closed-session row.
	await fromMenu(card, 'Open chat');
	await expect(card).toHaveClass(/selected/);
	await expect(tile).toHaveAttribute('data-topic', 'launch');
	await page.reload();
	await live(page);
	await expect(tile).toHaveAttribute('data-topic', 'launch');
	expect(await tile.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(colour);
	await page.getByRole('button', { name: '← All agents' }).click();
	await fromMenu(card, 'Close');
	await page.getByRole('button', { name: /^Closed \d+$/ }).click();
	const row = page.locator('.archive-item', { hasText: 'Credit maths' });
	await expect(row.locator('.topic')).toHaveAttribute('title', 'Release');
	expect(await row.locator('.topic').evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(
		colour
	);
	await page.getByRole('button', { name: /^All \d+$/ }).click();
});

test('search finds a chat by its title or by what was said in it, open or closed, and opens it', async ({
	page,
}) => {
	const box = page.getByRole('combobox', { name: 'Search chats' });
	// The shortcut puts the cursor in the box from anywhere.
	await page.keyboard.press('ControlOrMeta+k');
	await expect(box).toBeFocused();

	// By something said in the chat, not in any title.
	await box.fill('destinations');
	const results = page.getByRole('listbox', { name: 'Chats found' });
	await expect(results.getByRole('option')).toHaveCount(1);
	await expect(results.getByRole('option')).toContainText('Onboarding links');
	await expect(results.locator('mark').first()).toHaveText(/destinations/i);
	await box.press('Enter');
	const card = page.locator(CARD, { hasText: 'Onboarding links' });
	await expect(card).toHaveClass(/selected/);
	await expect(box).toHaveValue('');
	await page.getByRole('button', { name: '← All agents' }).click();

	// A closed chat is found too, marked as closed, and comes back when chosen.
	await box.fill('credit maths');
	const closed = results.getByRole('option', { name: /Credit maths/ });
	await expect(closed).toContainText('Closed');
	await closed.click();
	const reopened = page.locator(CARD, { hasText: 'Credit maths' });
	await expect(reopened).toHaveClass(/selected/);
	await page.getByRole('button', { name: '← All agents' }).click();
	await expect(reopened).toBeVisible();

	await box.fill('zzz nothing says this');
	await expect(results).toContainText('No chat mentions that.');
	await box.press('Escape');
	await expect(results).toBeHidden();
});

test('the artifact library lists what agents published or made, previews it, and searches it', async ({
	page,
}) => {
	await page.getByRole('button', { name: 'Artifacts' }).click();
	await expect(page).toHaveURL(/#artifacts$/);
	const library = page.getByRole('region', { name: 'Artifact library' });
	await expect(library.getByRole('heading', { name: 'Artifact library' })).toBeVisible();

	// The published page is there with a link to claude.ai; the one deleted afterwards is not.
	const pageCard = library.getByRole('link', { name: /Checkout prototype/ });
	await expect(pageCard).toHaveAttribute('href', 'https://claude.ai/artifact/SampleCheckout01');
	await expect(pageCard).toContainText('Web app · on claude.ai');
	await expect(pageCard.locator('iframe')).toHaveAttribute('src', /checkout\.html$/);
	await expect(library.locator('.artifact')).toHaveCount(2);
	await expect(library.getByText(/gone/i)).toHaveCount(0);

	// The spreadsheet the agent pointed to shows its first rows and opens from this computer.
	const sheet = library.getByRole('link', { name: /Rates/ });
	await expect(sheet).toContainText('Spreadsheet · on this computer');
	await expect(sheet.locator('table')).toContainText('AU');
	await expect(sheet).toHaveAttribute('href', /\/api\/files\/.*rates\.csv$/);

	await library.getByLabel('Search artifacts').fill('checkout');
	await expect(library.locator('.artifact')).toHaveCount(1);
	await library.getByLabel('Search artifacts').fill('');
	await library.getByRole('button', { name: 'Spreadsheets 1' }).click();
	await expect(library.locator('.artifact')).toHaveCount(1);

	// The page survives a reload, and Back returns to the agents.
	await page.reload();
	await expect(library.getByRole('heading', { name: 'Artifact library' })).toBeVisible();
	await page.getByRole('button', { name: 'Back to agents' }).click();
	await expect(page.getByRole('combobox', { name: 'Search chats' })).toBeVisible();
	await expect(library).toHaveCount(0);
});

test('what a chat made is kept at the foot of its card and opens from there', async ({ page }) => {
	const card = await createAgent(page, 'Status refresh', 'Fix the refresh and share the outputs');
	await expectState(card, 'Done');
	// The newest two are links on the line itself; the third waits behind "+1 more".
	const bar = card.getByRole('group', { name: 'Outputs of Status refresh' });
	await expect(bar.getByRole('link', { name: /Summary page/ })).toHaveAttribute(
		'href',
		'https://claude.ai/artifact/DemoSummary01'
	);
	await expect(bar.getByRole('link', { name: /DEMO-7 Fix the status refresh/ })).toHaveAttribute(
		'href',
		'https://example.atlassian.net/browse/DEMO-7'
	);
	await bar.getByRole('button', { name: '+1 more' }).click();
	const list = card.getByRole('list', { name: 'All outputs of Status refresh' });
	await expect(list.getByRole('link', { name: /DEMO-7/ })).toContainText('Jira ticket · Created');

	// The bar and its list leave the chat itself alone: messages still stack and wrap.
	const chat = card.locator('.output');
	expect(await chat.evaluate((el) => getComputedStyle(el).display)).toBe('block');
	expect(await chat.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);

	// Code changes opens the edits themselves.
	await list.getByRole('button', { name: /Code changes/ }).click();
	const changes = page.getByRole('dialog', { name: 'Code changes' });
	await expect(changes).toContainText("+ const title = 'New';");
	await page.keyboard.press('Escape');
	await expect(changes).toBeHidden();

	// The steps the agent took are one line between the messages, unfolding on a click.
	const steps = card.locator('details.steps').last();
	await expect(steps.locator('> summary')).toContainText(/\d+ steps/);
	await expect(steps.locator('.step').first()).toBeHidden();
	await steps.locator('> summary').click();
	await expect(steps.locator('.step').first()).toBeVisible();

	// The outputs are still there after a reload, and a chat that made nothing has no bar.
	await page.reload();
	await live(page);
	await expect(bar.getByRole('link', { name: /Summary page/ })).toBeVisible();
	await expect(
		page.locator(CARD, { hasText: 'Onboarding links' }).getByRole('group', { name: /^Outputs of/ })
	).toHaveCount(0);
});

test('a long chat follows new messages while you are at the end, and holds still while you read back', async ({
	page,
}) => {
	const card = page.locator(CARD, { hasText: 'Long history' });
	const chat = card.locator('.output');
	const fromEnd = () => chat.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
	const jump = card.getByRole('button', { name: '↓ New messages' });
	// Only the tail of the chat is on the page, and it opens at the latest message.
	await expect(card.getByRole('button', { name: /^Show \d+ earlier entries$/ })).toBeAttached();
	await expect.poll(fromEnd).toBeLessThan(5);

	// Messages arriving from elsewhere (not sent from this card) are followed, one after another.
	const prompt = (text: string) =>
		page.request.post('/api/sessions/long-history/prompt', { data: { text } });
	await prompt('first follow-up, share the outputs');
	await expectState(card, 'Running');
	await expectState(card, 'Done');
	await expect(card.locator('.response .you .bubble').last()).toHaveText(
		'first follow-up, share the outputs'
	);
	await expect.poll(fromEnd).toBeLessThan(5);
	await expect(jump).toHaveCount(0);

	// Scrolling back to read stops the following: the place is kept and the button offers the way back.
	await chat.hover();
	await page.mouse.wheel(0, -600);
	await expect.poll(fromEnd).toBeGreaterThan(300);
	const reading = card.getByText('Question 218', { exact: true });
	const top = async () => (await reading.boundingBox())?.y ?? 0;
	const before = await top();
	await prompt('second follow-up');
	await expectState(card, 'Running');
	await expectState(card, 'Done');
	await expect(jump).toBeVisible();
	expect(Math.abs((await top()) - before)).toBeLessThan(3);

	await jump.click();
	await expect.poll(fromEnd).toBeLessThan(5);
	await expect(jump).toHaveCount(0);
	// Back at the end, following resumes.
	await prompt('third follow-up, share the outputs');
	await expectState(card, 'Running');
	await expectState(card, 'Done');
	await expect.poll(fromEnd).toBeLessThan(5);
	await expect(jump).toHaveCount(0);
});

test('when a model runs out, the chat offers another and sends again; one switch moves every agent', async ({
	page,
}) => {
	const card = await createAgent(page, 'Reports', 'get the latest reports, usage limit');
	await expectState(card, 'Done');
	const notice = card.getByRole('group', { name: 'Usage limit reached' });
	await expect(notice).toContainText('Claude Fable 5.1 has reached its usage limit.');
	await expect(notice.getByLabel('Model to switch to')).toHaveValue('claude-opus-5-5');

	// One click: the chat moves to Opus and the same question is asked again on it.
	await notice.getByRole('button', { name: 'Switch and send again' }).click();
	await expect(card.locator('.response .you .bubble').last()).toHaveText(
		'get the latest reports, usage limit'
	);
	await expect(card.locator('.response')).toContainText('Model changed to Claude Opus 5.5.');

	// The workspace-wide switch puts every agent on one model from its next prompt.
	await page.getByLabel('Model for all agents').selectOption('claude-sonnet-5-5');
	await expect(page.getByRole('status').filter({ hasText: 'Every agent now uses' })).toContainText(
		'Claude Sonnet 5.5'
	);
	const nextModels = async () => {
		const body = (await (await page.request.get('/api/bootstrap')).json()) as {
			sessions: { model: string; nextModel?: string; provider: string }[];
		};
		return [...new Set(body.sessions.map((s) => s.nextModel ?? s.model))];
	};
	await expect.poll(nextModels).toEqual(['claude-sonnet-5-5']);
	await page.reload();
	await live(page);
	await expect(page.getByLabel('Model for all agents')).toHaveValue('claude-sonnet-5-5');
});
