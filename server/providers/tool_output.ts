import path from 'node:path';

export const MAX_TOOL_OUTPUT = 4000;

/** Clips a tool result for the transcript; the full text stays in Claude Code's own log. */
export function clipOutput(text: string, max = MAX_TOOL_OUTPUT): string {
	const trimmed = text.replace(/\s+$/, '');
	if (trimmed.length <= max) return trimmed;
	return `${trimmed.slice(0, max)}\n… (${trimmed.length - max} more characters)`;
}

interface ToolResultBlock {
	type: 'tool_result';
	tool_use_id: string;
	content?: unknown;
	is_error?: boolean;
}

export interface ToolResult {
	toolUseId: string;
	output: string;
	isError?: boolean;
	/** The result before clipping, for working out what the tool made. Never saved. */
	full?: string;
}

/** Enough of a result to find the address of what a tool made, without holding megabytes. */
const MAX_FULL = 200_000;

/** Pulls tool results out of a user message's content blocks, as the API delivers them. */
export function extractToolResults(content: unknown): ToolResult[] {
	if (!Array.isArray(content)) return [];
	const results: ToolResult[] = [];
	for (const block of content as { type?: string }[]) {
		if (block.type !== 'tool_result') continue;
		const result = block as ToolResultBlock;
		let text = '';
		if (typeof result.content === 'string') text = result.content;
		else if (Array.isArray(result.content)) {
			text = (result.content as { type?: string; text?: string }[])
				.map((part) =>
					part.type === 'text' && part.text ? part.text : part.type === 'image' ? '[image]' : ''
				)
				.filter(Boolean)
				.join('\n');
		}
		results.push({
			toolUseId: result.tool_use_id,
			output: clipOutput(text),
			isError: result.is_error || undefined,
			full: text.length > MAX_TOOL_OUTPUT ? text.slice(0, MAX_FULL) : undefined,
		});
	}
	return results;
}

/** A permission prompt should say what will happen, not which tool is involved. */
export function permissionTitle(toolName: string, input: Record<string, unknown>): string {
	const str = (key: string) =>
		typeof input[key] === 'string' ? (input[key] as string) : undefined;
	const file = str('file_path');
	switch (toolName) {
		case 'Bash':
			return str('description') ? `Run a command: ${str('description')}` : 'Run a command';
		case 'Edit':
		case 'Write':
		case 'NotebookEdit':
			return file ? `Change ${path.basename(file)}` : 'Change a file';
		case 'Read':
			return file ? `Read ${path.basename(file)}` : 'Read a file';
		case 'Glob':
		case 'Grep':
			return 'Search the project files';
		case 'WebFetch': {
			const url = str('url');
			try {
				return url ? `Fetch ${new URL(url).hostname}` : 'Fetch a web page';
			} catch {
				return 'Fetch a web page';
			}
		}
		case 'WebSearch':
			return 'Search the web';
		case 'Agent':
			return str('description') ? `Start a sub-agent: ${str('description')}` : 'Start a sub-agent';
		case 'ExitPlanMode':
			return 'Approve the plan';
		default:
			return `Use the ${toolName} tool`;
	}
}

const MAX_DIFF_LINES = 40;
const MAX_DIFF_LINE = 240;

/**
 * For a tool that edits a file, the change it asks for: removed lines marked `-`, added lines
 * marked `+`. Built from the tool's own input, so it shows before the result arrives.
 */
export function describeToolChange(
	toolName: string,
	input: Record<string, unknown>
): string | undefined {
	const text = (value: unknown) => (typeof value === 'string' ? value : '');
	const lines: string[] = [];
	const add = (mark: '-' | '+', value: unknown) => {
		const body = text(value);
		if (!body) return;
		for (const line of body.replace(/\n$/, '').split('\n'))
			lines.push(
				`${mark} ${line.length > MAX_DIFF_LINE ? `${line.slice(0, MAX_DIFF_LINE)}…` : line}`
			);
	};
	if (toolName === 'Edit') {
		add('-', input.old_string);
		add('+', input.new_string);
	} else if (toolName === 'MultiEdit' && Array.isArray(input.edits)) {
		for (const edit of input.edits as Record<string, unknown>[]) {
			add('-', edit?.old_string);
			add('+', edit?.new_string);
		}
	} else if (toolName === 'Write') {
		add('+', input.content);
	} else if (toolName === 'NotebookEdit') {
		add('+', input.new_source);
	}
	if (!lines.length) return undefined;
	if (lines.length <= MAX_DIFF_LINES) return lines.join('\n');
	return `${lines.slice(0, MAX_DIFF_LINES).join('\n')}\n… (${lines.length - MAX_DIFF_LINES} more lines)`;
}
