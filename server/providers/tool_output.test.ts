import { clipOutput, extractToolResults, permissionTitle } from './tool_output';

describe('extractToolResults', () => {
	it('reads string and block results, flags errors, and ignores everything else', () => {
		const results = extractToolResults([
			{ type: 'text', text: 'ignored' },
			{ type: 'tool_result', tool_use_id: 't1', content: 'plain output\n\n' },
			{
				type: 'tool_result',
				tool_use_id: 't2',
				content: [
					{ type: 'text', text: 'line one' },
					{ type: 'image' },
					{ type: 'text', text: 'line two' },
				],
				is_error: true,
			},
		]);
		expect(results).toEqual([
			{ toolUseId: 't1', output: 'plain output', isError: undefined },
			{ toolUseId: 't2', output: 'line one\n[image]\nline two', isError: true },
		]);
		expect(extractToolResults('not blocks')).toEqual([]);
	});
});

describe('clipOutput', () => {
	it('keeps short output and clips long output with a count', () => {
		expect(clipOutput('short')).toBe('short');
		const clipped = clipOutput('x'.repeat(4100), 4000);
		expect(clipped.startsWith('x'.repeat(4000))).toBe(true);
		expect(clipped.endsWith('… (100 more characters)')).toBe(true);
	});
});

describe('permissionTitle', () => {
	it.each(
		Object.entries({
			'described command': {
				tool: 'Bash',
				input: { command: 'npm test', description: 'Run the tests' },
				title: 'Run a command: Run the tests',
			},
			'bare command': { tool: 'Bash', input: { command: 'ls' }, title: 'Run a command' },
			'file edit': {
				tool: 'Edit',
				input: { file_path: '/repo/src/app.ts' },
				title: 'Change app.ts',
			},
			'file read': {
				tool: 'Read',
				input: { file_path: '/repo/README.md' },
				title: 'Read README.md',
			},
			search: { tool: 'Grep', input: { pattern: 'x' }, title: 'Search the project files' },
			'web fetch': {
				tool: 'WebFetch',
				input: { url: 'https://example.com/a/b' },
				title: 'Fetch example.com',
			},
			'bad url': { tool: 'WebFetch', input: { url: 'nope' }, title: 'Fetch a web page' },
			'sub-agent': {
				tool: 'Agent',
				input: { description: 'Review the diff' },
				title: 'Start a sub-agent: Review the diff',
			},
			plan: { tool: 'ExitPlanMode', input: {}, title: 'Approve the plan' },
			other: { tool: 'mcp__jira__create', input: {}, title: 'Use the mcp__jira__create tool' },
		})
	)('names a %s', (_name, { tool, input, title }) => {
		expect(permissionTitle(tool, input)).toBe(title);
	});
});

describe('describeToolChange', () => {
	it('lists what an edit takes out and puts in, and nothing for tools that change no file', async () => {
		const { describeToolChange } = await import('./tool_output');
		expect(describeToolChange('Edit', { old_string: 'a\nb', new_string: 'c' })).toBe(
			'- a\n- b\n+ c'
		);
		expect(
			describeToolChange('MultiEdit', {
				edits: [
					{ old_string: 'x', new_string: 'y' },
					{ old_string: 'p', new_string: '' },
				],
			})
		).toBe('- x\n+ y\n- p');
		expect(describeToolChange('Write', { content: 'one\ntwo\n' })).toBe('+ one\n+ two');
		expect(describeToolChange('Bash', { command: 'ls' })).toBeUndefined();
		expect(describeToolChange('Edit', {})).toBeUndefined();
		const long = describeToolChange('Write', {
			content: Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n'),
		})!;
		expect(long.split('\n')).toHaveLength(41);
		expect(long).toMatch(/… \(20 more lines\)$/);
	});
});
