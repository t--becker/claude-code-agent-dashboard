import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PermissionMode, ServerEvent, Session } from '@shared/types';
import type { Provider } from './providers/types';
import { FORK_NOTE, HttpError, RESUME_PROMPT } from './session_manager';
import { FakeExternalSource, makeManager, makeSession } from './test_helpers';

const tmp = os.tmpdir();

const baseInput = {
	title: 'Delivery dashboard',
	project: 'rcs_reporting',
	path: tmp,
	provider: 'claude-code' as const,
	model: 'claude-sonnet-5-5',
	prompt: 'Compare delivery times',
};

const waitForState = (get: () => Session, state: Session['state']) =>
	vi.waitFor(() => expect(get().state).toBe(state), { timeout: 3000, interval: 10 });

describe('SessionManager', () => {
	describe('create', () => {
		it('starts a Running session with the prompt in the transcript and runs it to Done', async () => {
			const { manager, store } = await makeManager();
			const created = await manager.create(baseInput);
			expect(created).toMatchObject({
				title: 'Delivery dashboard',
				project: 'rcs_reporting',
				path: tmp,
				branch: 'main',
				provider: 'claude-code',
				providerLabel: 'Claude Code',
				providerMode: 'demo',
				model: 'claude-sonnet-5-5',
				permissionMode: 'default',
				state: 'Running',
				closed: false,
				turns: 0,
			});
			expect(created.transcript.map((e) => e.kind)).toEqual(['user']);

			await waitForState(() => manager.get(created.id), 'Done');
			const done = manager.get(created.id);
			expect(done.turns).toBe(1);
			expect(done.providerSessionId).toMatch(/^demo-/);
			expect(done.transcript.filter((e) => e.kind === 'tool')).toHaveLength(2);
			const reply = done.transcript.find((e) => e.kind === 'assistant');
			expect(reply && 'text' in reply ? reply.text : '').toContain('Demo mode');
			expect(store.latest.map((s) => s.id)).toEqual([created.id]);
		});

		it.each(
			Object.entries({
				'blank folder': { ...baseInput, path: ' ', error: 'Choose the project folder' },
				'unknown provider': {
					...baseInput,
					provider: 'codex' as const,
					error: 'Unknown agent tool: codex',
				},
				'unknown model': {
					...baseInput,
					model: 'gpt-9',
					error: 'Model gpt-9 is not available for Claude Code',
				},
				'missing folder': {
					...baseInput,
					path: '/definitely/not/here',
					error: 'Folder not found: /definitely/not/here',
				},
				'unknown permission mode': {
					...baseInput,
					permissionMode: 'yolo' as never,
					error: 'Unknown permission mode: yolo',
				},
			})
		)('rejects a %s', async (_name, { error, ...input }) => {
			const { manager } = await makeManager();
			await expect(manager.create(input)).rejects.toMatchObject({ status: 400, message: error });
		});
	});

	describe('prompt', () => {
		it('refuses while the agent is busy and runs again once it is idle', async () => {
			const { manager } = await makeManager();
			const session = await manager.create(baseInput);
			await expect(manager.prompt(session.id, 'again')).rejects.toBeInstanceOf(HttpError);
			await waitForState(() => manager.get(session.id), 'Done');
			await manager.prompt(session.id, 'again');
			expect(manager.get(session.id).state).toBe('Running');
			await waitForState(() => manager.get(session.id), 'Done');
			expect(manager.get(session.id).turns).toBe(2);
			expect(manager.get(session.id).transcript.filter((e) => e.kind === 'user')).toHaveLength(2);
		});

		it('applies a queued model change to the next prompt only', async () => {
			const { manager } = await makeManager();
			const session = await manager.create(baseInput);
			manager.setNextModel(session.id, 'claude-opus-5-5');
			expect(manager.get(session.id)).toMatchObject({
				model: 'claude-sonnet-5-5',
				nextModel: 'claude-opus-5-5',
			});
			await waitForState(() => manager.get(session.id), 'Done');
			expect(manager.get(session.id).model).toBe('claude-sonnet-5-5');

			await manager.prompt(session.id, 'next');
			const after = manager.get(session.id);
			expect(after.model).toBe('claude-opus-5-5');
			expect(after.nextModel).toBeUndefined();
			expect(
				after.transcript.some(
					(e) => e.kind === 'system' && e.text === 'Model changed to Claude Opus 5.5.'
				)
			).toBe(true);
		});

		it('clears the queued model when it matches the current one and rejects unknown models', async () => {
			const { manager } = await makeManager();
			const session = await manager.create(baseInput);
			manager.setNextModel(session.id, 'claude-opus-5-5');
			manager.setNextModel(session.id, 'claude-sonnet-5-5');
			expect(manager.get(session.id).nextModel).toBeUndefined();
			expect(() => manager.setNextModel(session.id, 'nope')).toThrow(/not available/);
		});
	});

	describe('stop and resume', () => {
		it('stops a running agent, ignores its late events, and resumes with a continue prompt', async () => {
			const { manager } = await makeManager({ turnMs: 600 });
			const session = await manager.create(baseInput);
			await manager.stop(session.id);
			const stopped = manager.get(session.id);
			expect(stopped.state).toBe('Stopped');
			expect(
				stopped.transcript.some((e) => e.kind === 'system' && e.text === 'Stopped by you.')
			).toBe(true);

			await new Promise((resolve) => setTimeout(resolve, 150));
			expect(manager.get(session.id).state).toBe('Stopped');

			manager.resume(session.id);
			expect(manager.get(session.id).state).toBe('Running');
			await waitForState(() => manager.get(session.id), 'Done');
			const users = manager.get(session.id).transcript.filter((e) => e.kind === 'user');
			expect(users.map((e) => ('text' in e ? e.text : ''))).toEqual([
				baseInput.prompt,
				RESUME_PROMPT,
			]);
		});

		it('only resumes a stopped agent and only stops a busy one', async () => {
			const { manager } = await makeManager();
			const session = await manager.create(baseInput);
			expect(() => manager.resume(session.id)).toThrow(/Only a stopped agent/);
			await waitForState(() => manager.get(session.id), 'Done');
			await expect(manager.stop(session.id)).rejects.toThrow(/not running/);
		});
	});

	describe('needs input', () => {
		it('pauses for a decision, records the answer, and finishes', async () => {
			const { manager } = await makeManager();
			const session = await manager.create({ ...baseInput, prompt: 'Please decide the layout' });
			await waitForState(() => manager.get(session.id), 'Needs input');
			const pending = manager.get(session.id).pendingInput;
			expect(pending).toMatchObject({ kind: 'question', allowFreeText: true });
			expect(pending?.options.map((o) => o.id)).toEqual(['extended', 'minimal']);

			expect(() => manager.answer(session.id, { optionId: 'nope' })).toThrow(/Choose one/);
			manager.answer(session.id, { optionId: 'minimal' });
			expect(manager.get(session.id)).toMatchObject({ state: 'Running', pendingInput: undefined });
			await waitForState(() => manager.get(session.id), 'Done');
			const transcript = manager.get(session.id).transcript;
			expect(
				transcript.some((e) => e.kind === 'system' && e.text === 'You answered: Keep it minimal')
			).toBe(true);
			const reply = transcript.find((e) => e.kind === 'assistant');
			expect(reply && 'text' in reply ? reply.text : '').toContain('You chose: minimal');
		});

		it('accepts a typed answer and refuses answers when nothing is pending', async () => {
			const { manager } = await makeManager();
			const session = await manager.create({ ...baseInput, prompt: 'decide please' });
			await waitForState(() => manager.get(session.id), 'Needs input');
			manager.answer(session.id, { text: 'go wild' });
			expect(() => manager.answer(session.id, { text: 'again' })).toThrow(/not waiting/);
			await waitForState(() => manager.get(session.id), 'Done');
		});

		it('stopping while waiting clears the question', async () => {
			const { manager } = await makeManager();
			const session = await manager.create({ ...baseInput, prompt: 'decide please' });
			await waitForState(() => manager.get(session.id), 'Needs input');
			await manager.stop(session.id);
			expect(manager.get(session.id)).toMatchObject({ state: 'Stopped', pendingInput: undefined });
		});
	});

	describe('tool output', () => {
		it('attaches a tool result to the step that produced it', async () => {
			const provider: Provider = {
				id: 'claude-code',
				label: 'Claude Code',
				detect: async () => ({
					id: 'claude-code',
					label: 'Claude Code',
					mode: 'live',
					models: [{ id: 'sonnet', label: 'Sonnet' }],
					defaultModel: 'sonnet',
					modelsSource: 'test',
					supportsPermissionModes: true,
				}),
				run: (ctx) => {
					ctx.emit({ type: 'tool', name: 'Bash', summary: 'npm test', toolUseId: 'call-1' });
					ctx.emit({ type: 'tool_result', toolUseId: 'call-1', output: '12 passed' });
					ctx.emit({ type: 'tool_result', toolUseId: 'unknown', output: 'dropped' });
					ctx.emit({ type: 'done' });
					return { interrupt: async () => undefined };
				},
			};
			const { manager } = await makeManager({ provider });
			const session = await manager.create({ ...baseInput, model: 'sonnet' });
			await waitForState(() => manager.get(session.id), 'Done');
			const steps = manager.get(session.id).transcript.filter((e) => e.kind === 'tool');
			expect(steps).toEqual([
				expect.objectContaining({ name: 'Bash', toolUseId: 'call-1', output: '12 passed' }),
			]);
		});
	});

	describe('errors', () => {
		it('records a provider failure as Error with the message', async () => {
			const { manager } = await makeManager();
			const session = await manager.create({ ...baseInput, prompt: 'please fail' });
			await waitForState(() => manager.get(session.id), 'Error');
			const failed = manager.get(session.id);
			expect(failed.lastError).toBe('Demo failure requested by the prompt.');
			expect(failed.transcript.at(-1)).toMatchObject({
				kind: 'error',
				text: 'Demo failure requested by the prompt.',
			});
			await manager.prompt(session.id, 'try again');
			expect(manager.get(session.id).lastError).toBeUndefined();
		});
	});

	describe('close, reopen and delete', () => {
		it('closing keeps the run going; reopening restores the card', async () => {
			const { manager } = await makeManager();
			const session = await manager.create(baseInput);
			manager.close(session.id);
			expect(manager.get(session.id)).toMatchObject({ closed: true, state: 'Running' });
			await waitForState(() => manager.get(session.id), 'Done');
			expect(manager.get(session.id).closed).toBe(true);
			manager.reopen(session.id);
			expect(manager.get(session.id).closed).toBe(false);
		});

		it('deletes only closed sessions', async () => {
			const { manager } = await makeManager();
			const session = await manager.create(baseInput);
			await waitForState(() => manager.get(session.id), 'Done');
			await expect(manager.remove(session.id)).rejects.toThrow(/Close the agent/);
			manager.close(session.id);
			await manager.remove(session.id);
			expect(manager.list()).toEqual([]);
			expect(() => manager.get(session.id)).toThrow(/not found/);
		});
	});

	describe('init', () => {
		it('turns sessions that were running at shutdown into Stopped with a note', async () => {
			const running = makeSession({ state: 'Running', pendingInput: undefined });
			const waiting = makeSession({
				state: 'Needs input',
				pendingInput: { id: 'p', kind: 'question', title: 'q', options: [], allowFreeText: true },
			});
			const done = makeSession({ state: 'Done' });
			const { manager } = await makeManager({ initial: [running, waiting, done] });
			expect(manager.get(running.id).state).toBe('Stopped');
			expect(manager.get(waiting.id)).toMatchObject({ state: 'Stopped', pendingInput: undefined });
			expect(manager.get(waiting.id).transcript.at(-1)).toMatchObject({ kind: 'system' });
			expect(manager.get(done.id).state).toBe('Done');
		});
	});

	describe('events', () => {
		it('publishes session updates and stream text while running', async () => {
			const { manager, bus } = await makeManager();
			const events: ServerEvent[] = [];
			bus.subscribe((event) => events.push(event));
			const session = await manager.create(baseInput);
			await waitForState(() => manager.get(session.id), 'Done');
			const states = events
				.filter((e) => e.type === 'session')
				.map((e) => (e.type === 'session' ? e.session.state : ''));
			expect(states[0]).toBe('Running');
			expect(states.at(-1)).toBe('Done');
			const streams = events.filter((e) => e.type === 'stream');
			expect(streams.length).toBeGreaterThan(1);
			expect(streams.at(-1)).toMatchObject({ text: '' });
		});
	});

	describe('a new agent from a folder', () => {
		it('needs only the folder, is named by its first prompt, and keeps a name you give it', async () => {
			const { manager } = await makeManager();
			const card = await manager.create({ path: tmp });
			expect(card).toMatchObject({
				title: path.basename(tmp),
				titleAuto: true,
				project: path.basename(tmp),
				provider: 'claude-code',
				permissionMode: 'default',
				state: 'Done',
				turns: 0,
				transcript: [],
			});

			await manager.prompt(card.id, '\n  Fix the delivery report totals\nthen check the rest');
			const named = manager.get(card.id);
			expect(named.title).toBe('Fix the delivery report totals');
			expect(named.titleAuto).toBeUndefined();
			expect(named.state).toBe('Running');

			const other = await manager.create({ path: tmp });
			expect(manager.rename(other.id, '  My   own name ').title).toBe('My own name');
			await manager.prompt(other.id, 'something else entirely');
			expect(manager.get(other.id).title).toBe('My own name');
			expect(() => manager.rename(other.id, '   ')).toThrow(HttpError);
			expect(() => manager.rename(other.id, 'x'.repeat(121))).toThrow(HttpError);

			const long = await manager.create({ path: tmp });
			await manager.prompt(long.id, 'word '.repeat(40));
			expect(manager.get(long.id).title.length).toBeLessThanOrEqual(60);
			expect(manager.get(long.id).title.endsWith('…')).toBe(true);
		});
	});

	describe('outputs', () => {
		it('collects what an agent made during a run and keeps it with the chat', async () => {
			const { manager } = await makeManager();
			const card = await manager.create({ path: tmp, title: 'Status refresh' });
			expect(card.outputs).toBeUndefined();
			await manager.prompt(card.id, 'Fix it and share the outputs');
			await waitForState(() => manager.get(card.id), 'Done');
			expect(manager.get(card.id).outputs?.map((o) => [o.kind, o.label, o.verb, o.title])).toEqual([
				['code', '1 file', 'View diff', 'Code changes'],
				['ticket', 'Jira ticket', 'Created', 'DEMO-7 Fix the status refresh'],
				['artifact', 'Artifact', 'Published', 'Summary page'],
			]);
			expect(manager.get(card.id).outputs?.[1]?.url).toBe(
				'https://example.atlassian.net/browse/DEMO-7'
			);
			// A second run adds to the same list, without repeating anything.
			await manager.prompt(card.id, 'Share the outputs again');
			await waitForState(() => manager.get(card.id), 'Done');
			expect(manager.get(card.id).outputs).toHaveLength(3);
		});

		it('reads them out of a mirrored chat too', async () => {
			const external = new FakeExternalSource();
			external.add({ sessionId: 'o1', title: 'Docs work', cwd: tmp, lastModified: Date.now() }, [
				{
					type: 'assistant',
					uuid: 'a1',
					parent_tool_use_id: null,
					message: {
						role: 'assistant',
						content: [
							{
								type: 'tool_use',
								id: 't1',
								name: 'Bash',
								input: { command: 'gh pr create --title "Docs"' },
							},
						],
					},
				},
				{
					type: 'user',
					uuid: 'u1',
					parent_tool_use_id: null,
					message: {
						role: 'user',
						content: [
							{
								type: 'tool_result',
								tool_use_id: 't1',
								content: 'https://github.com/acme/docs/pull/3',
							},
						],
					},
				},
			]);
			const { manager } = await makeManager({ external });
			expect((await manager.importExternal('o1')).outputs).toMatchObject([
				{ kind: 'pr', title: 'Docs', verb: 'Opened', url: 'https://github.com/acme/docs/pull/3' },
			]);
		});
	});

	describe('topic icon', () => {
		it('is suggested from the first prompt, not the folder, and follows a rename until you choose', async () => {
			const { manager } = await makeManager();
			// The folder name alone says nothing about the work.
			const card = await manager.create({ path: tmp });
			expect(card.icon).toBeUndefined();

			const asked = await manager.prompt(
				card.id,
				'Can you check the metronome credit calculation?'
			);
			expect(asked.icon).toBe('metering');
			expect(asked.iconChosen).toBeUndefined();
			await waitForState(() => manager.get(card.id), 'Done');

			// Later prompts leave it alone; a new title can change the suggestion.
			expect((await manager.prompt(card.id, 'Now write the docs page')).icon).toBe('metering');
			await waitForState(() => manager.get(card.id), 'Done');
			expect(manager.rename(card.id, 'Pricing review').icon).toBe('pricing');
		});

		it('keeps the icon you pick through prompts and renames, and can hand it back', async () => {
			const { manager } = await makeManager();
			const card = await manager.create({ path: tmp, title: 'Registered MCP servers' });
			expect(card.icon).toBe('ai');

			const picked = manager.setIcon(card.id, 'launch');
			expect(picked).toMatchObject({ icon: 'launch', iconChosen: true });
			expect((await manager.prompt(card.id, 'Fix the failing tests')).icon).toBe('launch');
			await waitForState(() => manager.get(card.id), 'Done');
			expect(manager.rename(card.id, 'Pricing review').icon).toBe('launch');

			expect(() => manager.setIcon(card.id, '../nope')).toThrow(/Unknown icon/);
			const back = manager.setIcon(card.id, null);
			expect(back.icon).toBe('pricing');
			expect(back.iconChosen).toBeUndefined();
		});

		it('suggests one for a mirrored chat from its title and first message', async () => {
			const external = new FakeExternalSource();
			external.add({ sessionId: 'c1', title: 'Weekly sync', cwd: tmp, lastModified: Date.now() }, [
				{
					type: 'user',
					uuid: 'u1',
					parent_tool_use_id: null,
					message: { role: 'user', content: 'Draft the WhatsApp template for the campaign' },
				},
			]);
			const { manager } = await makeManager({ external });
			expect((await manager.importExternal('c1')).icon).toBe('whatsapp');
		});
	});

	describe('files in a prompt', () => {
		const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64');

		it('saves them, hands them to the agent, shows them on the prompt, and deletes them with the card', async () => {
			const { manager } = await makeManager();
			const card = await manager.create({ path: tmp });
			// A picture alone is a prompt.
			const sent = await manager.prompt(card.id, '', [
				{ name: 'shot.png', mediaType: 'image/png', data: png },
			]);
			const prompt = sent.transcript.at(-1);
			if (prompt?.kind !== 'user') throw new Error('expected the prompt');
			expect(prompt.images).toHaveLength(1);
			const file = prompt.images![0]!;
			expect(path.extname(file)).toBe('.png');
			expect(fs.readFileSync(file).toString('base64')).toBe(png);
			expect(fs.statSync(file).mode & 0o777).toBe(0o600);

			await waitForState(() => manager.get(card.id), 'Done');
			const reply = manager.get(card.id).transcript.find((e) => e.kind === 'assistant');
			expect(reply && 'text' in reply ? reply.text : '').toContain('I received 1 attached image');

			manager.close(card.id);
			await manager.remove(card.id);
			expect(fs.existsSync(file)).toBe(false);
			expect(fs.existsSync(path.dirname(file))).toBe(false);
		});

		it('takes a file of any type, keeps its name, and hands it to the agent by path', async () => {
			const { manager } = await makeManager();
			const card = await manager.create({ path: tmp });
			const text = Buffer.from('a,b\n1,2\n').toString('base64');
			const sent = await manager.prompt(card.id, 'Summarise these', [
				{ name: '../../.ssh/Q3 report (final).csv', mediaType: 'text/csv', data: text },
				// Called a picture, but it is not one: it goes as an ordinary file.
				{ name: 'fake.png', mediaType: 'image/png', data: text },
				{ name: 'shot.png', mediaType: 'image/png', data: png },
			]);
			const prompt = sent.transcript.at(-1);
			if (prompt?.kind !== 'user') throw new Error('expected the prompt');
			expect(prompt.text).toBe('Summarise these');
			expect(prompt.images).toHaveLength(1);
			expect(prompt.files?.map((f) => f.name)).toEqual(['Q3 report _final_.csv', 'fake.png']);
			const saved = prompt.files![0]!.path;
			// Saved in this card's own folder, whatever the name asked for.
			expect(path.basename(path.dirname(saved))).toBe(card.id);
			expect(path.basename(saved)).toMatch(/^[0-9a-f]{8}-Q3 report _final_\.csv$/);
			expect(fs.readFileSync(saved, 'utf8')).toBe('a,b\n1,2\n');
			expect(fs.statSync(saved).mode & 0o777).toBe(0o600);

			await waitForState(() => manager.get(card.id), 'Done');
			const reply = manager.get(card.id).transcript.find((e) => e.kind === 'assistant');
			expect(reply && 'text' in reply ? reply.text : '').toContain(
				'I received 1 attached image and 2 attached files'
			);
		});

		it('refuses what cannot be read, is empty, or is too much for one prompt', async () => {
			const { manager } = await makeManager();
			const card = await manager.create({ path: tmp });
			const refuse = (files: { mediaType: string; data: string }[]) =>
				expect(
					manager.prompt(
						card.id,
						'look',
						files.map((file) => ({ name: 'a.png', ...file }))
					)
				).rejects.toMatchObject({ status: 400 });
			await refuse([{ mediaType: 'image/png', data: '../../not base64' }]);
			await refuse([{ mediaType: 'image/png', data: '' }]);
			await refuse(Array.from({ length: 11 }, () => ({ mediaType: 'image/png', data: png })));
			await expect(manager.prompt(card.id, '   ')).rejects.toMatchObject({ status: 400 });
			expect(manager.get(card.id).state).toBe('Done');
			expect(manager.get(card.id).transcript).toEqual([]);
		});
	});

	describe('permissions for every agent', () => {
		it('sets every card at once and becomes the starting mode for new and mirrored cards', async () => {
			const external = new FakeExternalSource();
			const tmp = os.tmpdir();
			external.add({ sessionId: 'later', title: 'Later', cwd: tmp, lastModified: Date.now() });
			const { manager } = await makeManager({
				initial: [makeSession(), makeSession({ closed: true })],
				external,
				autoMirror: false,
			});
			expect(manager.defaultPermissionMode).toBe('default');

			const all = manager.setPermissionModeForAll('bypassPermissions');
			expect(all.map((s) => s.permissionMode)).toEqual(['bypassPermissions', 'bypassPermissions']);
			expect(all[0]!.transcript.at(-1)).toMatchObject({ kind: 'system' });
			expect(manager.defaultPermissionMode).toBe('bypassPermissions');

			const mirrored = await manager.importExternal('later');
			expect(mirrored.permissionMode).toBe('bypassPermissions');
			const created = await manager.create({
				title: 'New',
				project: 'p',
				path: tmp,
				provider: 'claude-code',
				model: 'claude-sonnet-5-5',
				prompt: 'hi',
			});
			expect(created.permissionMode).toBe('bypassPermissions');
			// A card can still be set on its own afterwards.
			expect(manager.setPermissionMode(created.id, 'plan').permissionMode).toBe('plan');
			expect(() => manager.setPermissionModeForAll('everything' as PermissionMode)).toThrow();
		});
	});

	describe('external chats', () => {
		const chat = (sessionId: string, lastModified: number, cwd = tmp) => ({
			sessionId,
			title: `Chat ${sessionId}`,
			cwd,
			branch: 'feature',
			createdAt: 1000,
			lastModified,
		});
		const prompt = (uuid: string, text: string) => ({
			type: 'user' as const,
			uuid,
			parent_tool_use_id: null,
			message: { role: 'user', content: text },
		});
		const reply = (uuid: string, text: string, model = 'claude-fable-5-1') => ({
			type: 'assistant' as const,
			uuid,
			parent_tool_use_id: null,
			message: { role: 'assistant', model, content: [{ type: 'text', text }] },
		});

		it('mirrors a chat with the process that has it open', async () => {
			const external = new FakeExternalSource();
			external.add(chat('live', Date.now()), [prompt('p1', 'hi'), reply('r1', 'hello')]);
			external.add(chat('old', Date.now() - 60 * 60 * 1000));
			external.openNow = [
				{ pid: 7, sessionId: 'old', status: 'idle', client: 'VS Code', name: 'shop-5e' },
			];
			const { manager } = await makeManager({ external });
			expect((await manager.importExternal('live')).external?.open).toBeUndefined();

			const card = await manager.importExternal('old');
			expect(card.external?.open).toEqual({
				pid: 7,
				status: 'idle',
				client: 'VS Code',
				name: 'shop-5e',
			});
			external.openNow = [];
			await manager.syncMirrors();
			expect(manager.get(card.id).external?.open).toBeUndefined();
		});

		it('imports a chat as an idle mirrored card with its transcript, branch and model', async () => {
			const external = new FakeExternalSource();
			external.add(chat('abc', Date.now()), [
				prompt('p1', 'Fix the links'),
				reply('r1', 'Fixed.'),
				prompt('p2', 'Thanks'),
			]);
			const { manager } = await makeManager({ external });
			const session = await manager.importExternal('abc');
			expect(session).toMatchObject({
				title: 'Chat abc',
				path: tmp,
				branch: 'feature',
				provider: 'claude-code',
				model: 'fable',
				state: 'Done',
				turns: 2,
				providerSessionId: 'abc',
				external: { sessionId: 'abc', active: true, messageCount: 3 },
			});
			expect(session.transcript.map((e) => e.kind)).toEqual([
				'system',
				'user',
				'assistant',
				'user',
			]);
			await expect(manager.importExternal('abc')).rejects.toMatchObject({ status: 409 });
			await expect(manager.importExternal('nope')).rejects.toMatchObject({ status: 404 });
			external.add(chat('gone', Date.now(), '/definitely/not/here'));
			await expect(manager.importExternal('gone')).rejects.toMatchObject({ status: 400 });
		});

		it('takes the folder from the open process when the saved chat records none', async () => {
			const external = new FakeExternalSource();
			external.add({ ...chat('nofolder', Date.now()), cwd: undefined }, [prompt('p1', 'hi')]);
			const { manager } = await makeManager({ external, autoMirror: false });
			await expect(manager.importExternal('nofolder')).rejects.toMatchObject({ status: 400 });
			external.openNow = [{ pid: 9, sessionId: 'nofolder', status: 'busy', cwd: tmp }];
			const session = await manager.importExternal('nofolder');
			expect(session).toMatchObject({ path: tmp, external: { open: { status: 'busy' } } });
		});

		it('mirrors new messages and the active flag as the chat moves on', async () => {
			const external = new FakeExternalSource();
			external.add(chat('abc', 5000), [prompt('p1', 'first')]);
			const { manager } = await makeManager({ external });
			const session = await manager.importExternal('abc');
			expect(manager.get(session.id).external?.active).toBe(false);

			external.chats.get('abc')!.messages.push(reply('r1', 'reply one'));
			external.chats.get('abc')!.info.lastModified = Date.now();
			await manager.syncMirrors();
			const synced = manager.get(session.id);
			expect(synced.transcript.at(-1)).toMatchObject({ kind: 'assistant', text: 'reply one' });
			expect(synced.external).toMatchObject({ active: true, messageCount: 2 });

			await manager.syncMirrors();
			expect(manager.get(session.id).transcript.filter((e) => e.kind === 'assistant')).toHaveLength(
				1
			);
		});

		it('mirrors open chats on its own, closes the card when the chat closes, and reopens it when it returns', async () => {
			const external = new FakeExternalSource();
			external.add(chat('open-a', Date.now()), [prompt('p1', 'hello')]);
			external.add(chat('gone', Date.now(), '/definitely/not/here'));
			external.openNow = [
				{ pid: 1, sessionId: 'open-a', status: 'busy', client: 'VS Code' },
				{ pid: 2, sessionId: 'gone', status: 'idle' },
			];
			const { manager } = await makeManager({ external });
			await manager.syncMirrors();
			const cards = manager.list();
			expect(
				cards.map((c) => [c.title, c.closed, c.external?.auto, c.external?.open?.pid])
			).toEqual([['Chat open-a', false, true, 1]]);
			expect(cards[0]?.transcript[0]).toMatchObject({
				kind: 'system',
				text: expect.stringContaining('Mirroring the open'),
			});

			external.openNow = [];
			await manager.syncMirrors();
			expect(manager.list()[0]).toMatchObject({ closed: true });
			expect(manager.list()[0]?.transcript.at(-1)).toMatchObject({
				text: expect.stringContaining('chat closed'),
			});

			external.openNow = [{ pid: 3, sessionId: 'open-a', status: 'idle' }];
			await manager.syncMirrors();
			expect(manager.list()[0]).toMatchObject({ closed: false, external: { open: { pid: 3 } } });
			expect(manager.list()).toHaveLength(1);
		});

		it('leaves manually imported and deleted chats alone', async () => {
			const external = new FakeExternalSource();
			external.add(chat('manual', Date.now()), [prompt('p1', 'hello')]);
			external.add(chat('deleted', Date.now()), [prompt('p1', 'hello')]);
			const { manager } = await makeManager({ external });
			const manual = await manager.importExternal('manual');
			external.openNow = [{ pid: 9, sessionId: 'deleted', status: 'idle' }];
			await manager.syncMirrors();
			const auto = manager.list().find((c) => c.external?.sessionId === 'deleted')!;
			manager.close(auto.id);
			await manager.remove(auto.id);
			await manager.syncMirrors();
			expect(manager.list().map((c) => c.id)).toEqual([manual.id]);
			external.openNow = [];
			await manager.syncMirrors();
			expect(manager.get(manual.id).closed).toBe(false);
		});

		it('re-reads a card mirrored before tool outputs were recorded', async () => {
			const external = new FakeExternalSource();
			external.add(chat('abc', 5000), [
				prompt('p1', 'run it'),
				{
					type: 'assistant',
					uuid: 'r1',
					parent_tool_use_id: null,
					message: {
						role: 'assistant',
						model: 'claude-fable-5-1',
						content: [{ type: 'tool_use', id: 'call-1', name: 'Bash', input: { command: 'ls' } }],
					},
				},
				{
					type: 'user',
					uuid: 'p2',
					parent_tool_use_id: null,
					message: {
						role: 'user',
						content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'a b' }],
					},
				},
			]);
			const { manager } = await makeManager({ external });
			const session = await manager.importExternal('abc');
			// Simulate the older on-disk shape: a step without its tool id.
			const stale = manager.get(session.id);
			stale.transcript = stale.transcript.map((e) =>
				e.kind === 'tool' ? { ...e, toolUseId: undefined, output: undefined } : e
			);
			await manager.syncMirrors();
			const steps = manager.get(session.id).transcript.filter((e) => e.kind === 'tool');
			expect(steps).toEqual([expect.objectContaining({ toolUseId: 'call-1', output: 'a b' })]);
			expect(manager.get(session.id).transcript[0]).toMatchObject({
				kind: 'system',
				text: expect.stringContaining('Mirroring'),
			});
		});

		it('can be told not to mirror automatically', async () => {
			const external = new FakeExternalSource();
			external.add(chat('open-a', Date.now()));
			external.openNow = [{ pid: 1, sessionId: 'open-a', status: 'busy' }];
			const { manager } = await makeManager({ external, autoMirror: false });
			await manager.syncMirrors();
			expect(manager.list()).toEqual([]);
		});

		it('continuing a mirrored chat forks it: the card stops mirroring once the provider reports a new session', async () => {
			const forking: Provider = {
				id: 'claude-code',
				label: 'Claude Code',
				detect: async () => ({
					id: 'claude-code',
					label: 'Claude Code',
					mode: 'live',
					models: [{ id: 'fable', label: 'Fable 5.1', resolves: 'claude-fable-5-1' }],
					defaultModel: 'fable',
					modelsSource: 'test',
					supportsPermissionModes: true,
				}),
				run: (ctx) => {
					expect(ctx.session.external?.sessionId).toBe('abc');
					ctx.emit({ type: 'init', providerSessionId: 'forked-id' });
					ctx.emit({ type: 'assistant', text: 'continued here' });
					ctx.emit({ type: 'done' });
					return { interrupt: async () => undefined };
				},
			};
			const external = new FakeExternalSource();
			external.add(chat('abc', Date.now()), [prompt('p1', 'first')]);
			const { manager } = await makeManager({ external, provider: forking });
			const session = await manager.importExternal('abc');
			await manager.prompt(session.id, 'carry on');
			await waitForState(() => manager.get(session.id), 'Done');
			const after = manager.get(session.id);
			expect(after.providerSessionId).toBe('forked-id');
			expect(after.external).toBeUndefined();
			expect(after.transcript.some((e) => e.kind === 'system' && e.text === FORK_NOTE)).toBe(true);
		});
	});

	describe('permission mode', () => {
		it('changes the mode for later prompts and refuses unknown modes', async () => {
			const session = makeSession({ state: 'Done' });
			const { manager, store } = await makeManager({ initial: [session] });
			const after = manager.setPermissionMode(session.id, 'bypassPermissions');
			expect(after.permissionMode).toBe('bypassPermissions');
			expect(after.transcript.at(-1)).toMatchObject({
				kind: 'system',
				text: 'Permissions changed to Bypass all permission checks.',
			});
			expect(store.latest.find((s) => s.id === session.id)?.permissionMode).toBe(
				'bypassPermissions'
			);
			const again = manager.setPermissionMode(session.id, 'bypassPermissions');
			expect(again.transcript).toHaveLength(after.transcript.length);
			expect(() => manager.setPermissionMode(session.id, 'nope' as PermissionMode)).toThrow(
				/Unknown permission mode/
			);
		});
	});
});
