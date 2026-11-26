import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	convertMessages,
	trimEntries,
	type ExternalMessage,
	readOpenSessions,
} from './claude_sessions';

const user = (uuid: string, content: unknown, parent: string | null = null): ExternalMessage => ({
	type: 'user',
	uuid,
	parent_tool_use_id: parent,
	message: { role: 'user', content },
});
const assistant = (
	uuid: string,
	model: string,
	content: unknown[],
	parent: string | null = null
): ExternalMessage => ({
	type: 'assistant',
	uuid,
	parent_tool_use_id: parent,
	message: { role: 'assistant', model, content },
});

describe('convertMessages', () => {
	it('keeps prompts, replies and tool calls; drops reminders, tool results, thinking, system and subagent frames', () => {
		const messages: ExternalMessage[] = [
			user('u1', '<system-reminder>context</system-reminder>\nFix the links'),
			assistant('a1', 'claude-sonnet-5-5', [
				{ type: 'thinking', thinking: '' },
				{ type: 'text', text: 'On it.' },
				{ type: 'tool_use', id: 'call-1', name: 'Bash', input: { command: 'npm test' } },
			]),
			user('u2', [
				{ type: 'tool_result', tool_use_id: 'call-1', content: '12 passed' },
				{ type: 'tool_result', tool_use_id: 'from-earlier-batch', content: 'late', is_error: true },
			]),
			assistant('a2', 'claude-haiku-5-5', [{ type: 'text', text: 'from a subagent' }], 't1'),
			{ type: 'system', uuid: 's1', parent_tool_use_id: null, message: { content: 'compacted' } },
			user('u3', [{ type: 'document', source: {} }]),
			assistant('a3', 'claude-opus-5-5', [{ type: 'text', text: 'Done.' }]),
		];
		const { entries, lastModel, prompts, orphanResults } = convertMessages(messages, 1000);
		expect(
			entries.map((e) =>
				e.kind === 'tool' ? `tool:${e.name}:${e.summary}` : `${e.kind}:${e.text}`
			)
		).toEqual([
			'user:Fix the links',
			'assistant:On it.',
			'tool:Bash:npm test',
			'user:[attached file]',
			'assistant:Done.',
		]);
		expect(lastModel).toBe('claude-opus-5-5');
		expect(prompts).toBe(2);
		expect(entries[2]).toMatchObject({ kind: 'tool', toolUseId: 'call-1', output: '12 passed' });
		expect(orphanResults).toEqual([
			{ toolUseId: 'from-earlier-batch', output: 'late', isError: true },
		]);
		expect(entries.map((e) => e.ts)).toEqual([1000, 1001, 1001, 1005, 1006]);
	});

	it('returns nothing for an empty or reminder-only chat', () => {
		expect(convertMessages([], 0)).toEqual({
			entries: [],
			lastModel: undefined,
			prompts: 0,
			orphanResults: [],
			outputs: [],
		});
		expect(convertMessages([user('u', '<system-reminder>x</system-reminder>')], 0).entries).toEqual(
			[]
		);
	});
});

describe('trimEntries', () => {
	it('keeps the tail and says how much was cut', () => {
		const entries = Array.from({ length: 5 }, (_, i) => ({
			id: `e${i}`,
			ts: i,
			kind: 'user' as const,
			text: `p${i}`,
		}));
		expect(trimEntries(entries, 10)).toBe(entries);
		const trimmed = trimEntries(entries, 2);
		expect(trimmed.map((e) => e.id)).toEqual(['trimmed-e3', 'e3', 'e4']);
		expect(trimmed[0]).toMatchObject({
			kind: 'system',
			text: '3 earlier entries are not shown here.',
		});
	});
});

describe('readOpenSessions', () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(path.join(os.tmpdir(), 'claude-sessions-'));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it('reads live process entries, maps the client name, and ignores stale, foreign and broken files', async () => {
		const entry = (pid: number, sessionId: string, extra: Record<string, unknown> = {}) =>
			writeFileSync(
				path.join(dir, `${pid}.json`),
				JSON.stringify({
					pid,
					sessionId,
					cwd: '/Users/me/projects/shop',
					status: 'busy',
					entrypoint: 'claude-vscode',
					name: 'shop-61',
					...extra,
				})
			);
		entry(101, 'live-vscode');
		entry(102, 'live-cli', { entrypoint: 'cli', status: 'idle', name: undefined });
		entry(103, 'dead');
		writeFileSync(path.join(dir, '104.json'), '{not json');
		writeFileSync(path.join(dir, '105.abc.key'), 'secret');
		writeFileSync(path.join(dir, 'notes.json'), JSON.stringify({ pid: 101, sessionId: 'foreign' }));
		const alive = (pid: number) => pid !== 103;
		const open = await readOpenSessions(dir, alive);
		expect(open.map((o) => [o.pid, o.sessionId, o.client, o.status, o.name])).toEqual([
			[101, 'live-vscode', 'VS Code', 'busy', 'shop-61'],
			[102, 'live-cli', 'terminal', 'idle', undefined],
		]);
	});

	it('returns nothing when the directory is missing', async () => {
		expect(await readOpenSessions(path.join(dir, 'missing'))).toEqual([]);
	});
});

describe('message times', () => {
	it('reads each message time from the saved chat, picking up only what was added since', async () => {
		const fs = await import('node:fs/promises');
		const os = await import('node:os');
		const path = await import('node:path');
		const { MessageTimes, convertMessages } = await import('./claude_sessions');
		const projects = await fs.mkdtemp(path.join(os.tmpdir(), 'aw-times-'));
		const file = path.join(projects, '-Users-me-repo', 'chat-1.jsonl');
		await fs.mkdir(path.dirname(file));
		const record = (uuid: string, timestamp: string) => `${JSON.stringify({ uuid, timestamp })}\n`;
		await fs.writeFile(file, record('m1', '2026-11-26T01:00:00.000Z') + 'not json\n');
		const times = new MessageTimes(projects);
		expect(await times.of('chat-1')).toEqual(new Map([['m1', Date.parse('2026-11-26T01:00:00Z')]]));
		// A record still being written is left until its line is complete.
		await fs.appendFile(file, record('m2', '2026-11-26T01:05:00.000Z') + '{"uuid":"m3"');
		expect([...(await times.of('chat-1')).keys()]).toEqual(['m1', 'm2']);
		expect(await times.of('missing')).toEqual(new Map());
		expect(await times.of('../chat-1')).toEqual(new Map());

		const at = Date.parse('2026-11-26T01:05:00Z');
		const { entries } = convertMessages(
			[
				{
					type: 'user',
					uuid: 'm2',
					parent_tool_use_id: null,
					timestamp: at,
					message: { role: 'user', content: 'hello' },
				},
				{
					type: 'assistant',
					uuid: 'm4',
					parent_tool_use_id: null,
					message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
				},
			],
			1000
		);
		// A message with no recorded time never sorts before the one it follows.
		expect(entries.map((entry) => entry.ts)).toEqual([at, at]);
		await fs.rm(projects, { recursive: true, force: true });
	});
});
