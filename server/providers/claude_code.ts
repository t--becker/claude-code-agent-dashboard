import {
	query,
	type Options,
	type PermissionResult,
	type PermissionUpdate,
	type Query,
	type SDKMessage,
	type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { ModelOption, ProviderInfo } from '@shared/types';
import type { SavedFile } from '../attachments';
import type { ServerConfig } from '../config';
import { describeToolChange, extractToolResults, permissionTitle } from './tool_output';
import {
	STOPPED_ANSWER,
	makeStreamer,
	promptWithFiles,
	type Provider,
	type ProviderEvent,
	type RunContext,
	type RunHandle,
} from './types';

/** Used only when the SDK cannot report its own model list (demo mode). */
export const CLAUDE_FALLBACK_MODELS: ModelOption[] = [
	{ id: 'claude-fable-5-1', label: 'Claude Fable 5.1' },
	{ id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
	{ id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
	{ id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
];

interface AskQuestion {
	question: string;
	header?: string;
	options?: { label: string; description?: string }[];
}

/** The parent Claude Code session (when this server runs inside one) sets vars a child must not inherit. */
function childEnv(): Record<string, string | undefined> {
	const env: Record<string, string | undefined> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (key === 'CLAUDECODE' || key === 'CLAUDE_PID' || key === 'CLAUDE_EFFORT') continue;
		if (key.startsWith('CLAUDE_CODE_') || key.startsWith('CLAUDE_AGENT_SDK_')) continue;
		env[key] = value;
	}
	env.CLAUDE_AGENT_SDK_CLIENT_APP = 'agent-workspace/0.1.0';
	return env;
}

function baseOptions(cwd: string, executable: string | undefined): Options {
	return {
		cwd,
		env: childEnv(),
		pathToClaudeCodeExecutable: executable,
		settingSources: ['user', 'project', 'local'],
		systemPrompt: { type: 'preset', preset: 'claude_code' },
	};
}

type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

/** Pictures go to the model as pictures; every other file is named by path for Claude to read. */
async function* single(prompt: string, files: SavedFile[] = []): AsyncGenerator<SDKUserMessage> {
	const images = files.filter((file) => file.imageData);
	const text = promptWithFiles(
		prompt,
		files.filter((file) => !file.imageData)
	);
	yield {
		type: 'user',
		message: {
			role: 'user',
			content: images.length
				? [
						...images.map((image) => ({
							type: 'image' as const,
							source: {
								type: 'base64' as const,
								media_type: image.mediaType as ImageMediaType,
								data: image.imageData ?? '',
							},
						})),
						...(text ? [{ type: 'text' as const, text }] : []),
					]
				: text,
		},
		parent_tool_use_id: null,
		session_id: '',
	};
}

/** An input stream that stays open without ever sending a prompt, for control-only probes. */
const never: AsyncIterable<SDKUserMessage> = {
	[Symbol.asyncIterator]: () => ({ next: () => new Promise(() => undefined) }),
};

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(err: unknown) => {
				clearTimeout(timer);
				reject(err);
			}
		);
	});
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function describeToolInput(name: string, input: Record<string, unknown>): string {
	const str = (key: string) =>
		typeof input[key] === 'string' ? (input[key] as string) : undefined;
	const clip = (text: string, max = 300) =>
		text.length > max ? `${text.slice(0, max - 1)}…` : text;
	switch (name) {
		case 'Bash':
			return clip(
				str('description')
					? `${str('description')} — ${str('command') ?? ''}`
					: (str('command') ?? '')
			);
		case 'Read':
		case 'Edit':
		case 'Write':
		case 'NotebookEdit':
			return str('file_path') ?? '';
		case 'Glob':
		case 'Grep':
			return [str('pattern'), str('path')].filter(Boolean).join(' in ');
		case 'WebFetch':
			return str('url') ?? '';
		case 'WebSearch':
			return str('query') ?? '';
		case 'Agent':
			return str('description') ?? '';
		case 'Skill':
			return str('skill') ?? '';
		case 'ExitPlanMode':
			return clip(str('plan') ?? 'Approve the plan', 1200);
		default:
			return clip(JSON.stringify(input) ?? '');
	}
}

/**
 * Runs Claude Code through the Agent SDK. One `query()` per prompt, resumed by
 * session id, so a model change naturally applies to the next prompt only.
 * Permission prompts and AskUserQuestion surface as "Needs input".
 */
export class ClaudeCodeProvider implements Provider {
	readonly id = 'claude-code' as const;
	readonly label = 'Claude Code';

	private constructor(
		private readonly info: ProviderInfo,
		private readonly executable: string | undefined
	) {}

	static async detect(
		config: ServerConfig,
		log: (message: string) => void
	): Promise<{ provider: ClaudeCodeProvider } | { reason: string }> {
		const executable = process.env.CLAUDE_EXECUTABLE || undefined;
		let probe: Query | undefined;
		try {
			probe = query({
				prompt: never,
				options: { ...baseOptions(config.dataDir, executable), permissionMode: 'default' },
			});
			const account = await withTimeout(probe.accountInfo(), 45_000, 'Claude Code account check');
			const signedIn = Boolean(
				account.email ||
				account.tokenSource ||
				(account.apiKeySource && account.apiKeySource !== 'none')
			);
			if (!signedIn)
				return { reason: 'Claude Code is not signed in (run `claude` once and log in)' };
			const models = await withTimeout(probe.supportedModels(), 30_000, 'Claude Code model list');
			const options: ModelOption[] = models.map((m) => ({
				id: m.value,
				label: m.displayName,
				description: m.resolvedModel ? `${m.description} → ${m.resolvedModel}` : m.description,
				resolves: m.resolvedModel,
			}));
			if (!options.length) return { reason: 'Claude Code reported no models' };
			log(
				`Claude Code: signed in as ${account.email ?? 'unknown'} (${account.subscriptionType ?? account.apiProvider ?? 'unknown plan'})`
			);
			const info: ProviderInfo = {
				id: 'claude-code',
				label: 'Claude Code',
				mode: 'live',
				models: options,
				defaultModel: options[0]!.id,
				modelsSource: 'Claude Code supportedModels()',
				supportsPermissionModes: true,
			};
			return { provider: new ClaudeCodeProvider(info, executable) };
		} catch (err) {
			return { reason: `Claude Code could not start: ${errorMessage(err)}` };
		} finally {
			probe?.close();
		}
	}

	async detect(): Promise<ProviderInfo> {
		return this.info;
	}

	run(ctx: RunContext): RunHandle {
		const { session } = ctx;
		const abort = new AbortController();
		const streamer = makeStreamer(ctx);
		let finished = false;
		let interrupted = false;
		let sawText = false;
		const finish = (event: ProviderEvent) => {
			if (finished) return;
			finished = true;
			streamer.cancel();
			ctx.emit(event);
		};

		const options: Options = {
			...baseOptions(session.path, this.executable),
			model: session.model,
			permissionMode: session.permissionMode,
			allowDangerouslySkipPermissions: session.permissionMode === 'bypassPermissions',
			resume: session.providerSessionId,
			// A mirrored chat may still be open in a terminal; branch off rather than write into its transcript.
			forkSession: session.external ? true : undefined,
			includePartialMessages: true,
			// Attached files are saved outside the project folder; let the agent read its own.
			additionalDirectories: ctx.attachmentsDir ? [ctx.attachmentsDir] : undefined,
			abortController: abort,
			canUseTool: (toolName, input, extra) =>
				this.permission(ctx, toolName, input, extra.suggestions),
			stderr: (data) => ctx.log(data.trimEnd()),
		};
		const q = query({ prompt: single(ctx.prompt, ctx.files), options });

		// The card shows which step the agent is on. Only the step's name is sent: the content
		// of a thinking block is never read here, so none of it can reach the browser.
		let lastActivity = '';
		const activity = (label: string) => {
			if (label === lastActivity) return;
			lastActivity = label;
			ctx.emit({ type: 'activity', label });
		};
		activity('Starting');

		const handle = (message: SDKMessage): boolean => {
			switch (message.type) {
				case 'system':
					if (message.subtype === 'init') {
						ctx.emit({ type: 'init', providerSessionId: message.session_id });
					} else if (message.subtype === 'permission_denied') {
						ctx.emit({
							type: 'tool',
							name: message.tool_name,
							summary: `Denied: ${message.message}`,
						});
					} else if (message.subtype === 'status') {
						if (message.status === 'compacting') activity('Compacting the conversation');
						else if (message.status === 'requesting') activity('Waiting for Claude');
					} else if (message.subtype === 'api_retry') {
						activity(`Retrying the request (attempt ${message.attempt} of ${message.max_retries})`);
					} else if (message.subtype === 'task_started') {
						activity(`Subagent started: ${message.description}`);
					} else if (message.subtype === 'task_progress' && message.last_tool_name) {
						activity(`Subagent running ${message.last_tool_name}`);
					}
					return false;
				case 'stream_event': {
					if (message.parent_tool_use_id) return false;
					const event = message.event;
					if (event.type === 'content_block_start') {
						const block = event.content_block;
						if (block.type === 'thinking' || block.type === 'redacted_thinking')
							activity('Thinking');
						else if (block.type === 'text') activity('Writing the reply');
						else if (block.type === 'tool_use') activity(`Preparing ${block.name}`);
					} else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
						streamer.push(event.delta.text);
					}
					return false;
				}
				case 'assistant': {
					if (message.parent_tool_use_id) {
						for (const block of message.message.content) {
							if (block.type === 'tool_use') activity(`Subagent running ${block.name}`);
						}
						return false;
					}
					for (const block of message.message.content) {
						if (block.type === 'text' && block.text.trim()) {
							streamer.take();
							sawText = true;
							ctx.emit({ type: 'assistant', text: block.text });
						} else if (block.type === 'tool_use') {
							activity(`Running ${block.name}`);
							ctx.emit({
								type: 'tool',
								name: block.name,
								summary: describeToolInput(
									block.name,
									(block.input ?? {}) as Record<string, unknown>
								),
								toolUseId: block.id,
								diff: describeToolChange(
									block.name,
									(block.input ?? {}) as Record<string, unknown>
								),
							});
						}
					}
					return false;
				}
				case 'user': {
					if (message.parent_tool_use_id) return false;
					const results = extractToolResults(message.message.content);
					for (const result of results) {
						ctx.emit({ type: 'tool_result', ...result });
					}
					if (results.length) activity('Reading the result');
					return false;
				}
				case 'result': {
					if (message.subtype === 'success') {
						if (!sawText && message.result?.trim())
							ctx.emit({ type: 'assistant', text: message.result });
						finish(
							interrupted ? { type: 'stopped' } : { type: 'done', costUsd: message.total_cost_usd }
						);
					} else {
						const detail = message.errors?.length
							? message.errors.join('; ')
							: message.subtype.replace(/^error_/, '').replace(/_/g, ' ');
						finish(interrupted ? { type: 'stopped' } : { type: 'error', message: detail });
					}
					return true;
				}
				case 'auth_status':
					if (message.error) {
						finish({ type: 'error', message: message.error });
						return true;
					}
					return false;
				default:
					return false;
			}
		};

		(async () => {
			for await (const message of q) {
				if (handle(message)) break;
			}
			finish(interrupted ? { type: 'stopped' } : { type: 'done' });
		})()
			.catch((err: unknown) => {
				finish(interrupted ? { type: 'stopped' } : { type: 'error', message: errorMessage(err) });
			})
			.finally(() => q.close());

		return {
			interrupt: async () => {
				interrupted = true;
				try {
					await withTimeout(q.interrupt(), 10_000, 'interrupt');
				} catch (err) {
					ctx.log(`interrupt: ${errorMessage(err)}`);
				}
				setTimeout(() => {
					if (!finished) {
						abort.abort();
						finish({ type: 'stopped' });
					}
				}, 5_000).unref();
			},
		};
	}

	private async permission(
		ctx: RunContext,
		toolName: string,
		input: Record<string, unknown>,
		suggestions: PermissionUpdate[] | undefined
	): Promise<PermissionResult> {
		if (toolName === 'AskUserQuestion') {
			const questions = Array.isArray(input.questions) ? (input.questions as AskQuestion[]) : [];
			const answers: Record<string, string> = {};
			for (const question of questions) {
				const options = (question.options ?? []).map((o, i) => ({
					id: `option-${i}`,
					label: o.label,
					description: o.description,
				}));
				const answer = await ctx.ask({
					kind: 'question',
					title: question.question,
					detail: question.header,
					options,
					allowFreeText: true,
				});
				if (answer.optionId === STOPPED_ANSWER) {
					return { behavior: 'deny', message: 'The user stopped the agent.', interrupt: true };
				}
				const chosen = options.find((o) => o.id === answer.optionId);
				answers[question.question] = answer.text?.trim() || chosen?.label || '';
			}
			return { behavior: 'allow', updatedInput: { ...input, answers } };
		}

		const options = [
			{ id: 'allow', label: 'Allow' },
			...(suggestions?.length ? [{ id: 'always', label: 'Allow for this session' }] : []),
			{ id: 'deny', label: 'Deny' },
		];
		const answer = await ctx.ask({
			kind: 'permission',
			title: permissionTitle(toolName, input),
			detail: describeToolInput(toolName, input),
			toolName,
			options,
			allowFreeText: false,
		});
		switch (answer.optionId) {
			case 'allow':
				return { behavior: 'allow', updatedInput: input };
			case 'always':
				return { behavior: 'allow', updatedInput: input, updatedPermissions: suggestions };
			case STOPPED_ANSWER:
				return { behavior: 'deny', message: 'The user stopped the agent.', interrupt: true };
			default:
				return { behavior: 'deny', message: 'The user denied this tool use.' };
		}
	}
}
