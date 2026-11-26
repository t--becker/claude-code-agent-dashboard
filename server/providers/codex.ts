import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ModelOption, PermissionMode, ProviderInfo } from '@shared/types';
import { promptWithFiles, type Provider, type RunContext, type RunHandle } from './types';

export const CODEX_FALLBACK_MODELS: ModelOption[] = [
	{ id: 'gpt-5.2-codex', label: 'gpt-5.2-codex' },
	{ id: 'gpt-5.2', label: 'gpt-5.2' },
	{ id: 'gpt-5.1-codex-max', label: 'gpt-5.1-codex-max' },
	{ id: 'gpt-5.1-codex', label: 'gpt-5.1-codex' },
	{ id: 'gpt-5.1-codex-mini', label: 'gpt-5.1-codex-mini' },
];

interface CodexModels {
	models: ModelOption[];
	defaultModel: string;
	source: string;
}

/** The Codex CLI caches the model catalogue it was served; read it rather than guessing. */
export function readCodexModels(codexHome = path.join(os.homedir(), '.codex')): CodexModels {
	let models = CODEX_FALLBACK_MODELS;
	let source = 'built-in fallback list';
	const cacheFile = path.join(codexHome, 'models_cache.json');
	try {
		const parsed = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as {
			models?: { slug?: string; display_name?: string; description?: string }[];
		};
		const fromCache = (parsed.models ?? [])
			.filter((m): m is { slug: string; display_name?: string; description?: string } => !!m.slug)
			.map((m) => ({ id: m.slug, label: m.display_name || m.slug, description: m.description }));
		if (fromCache.length) {
			models = fromCache;
			source = `~/.codex/models_cache.json`;
		}
	} catch {
		// No cache: fall back to the static list.
	}
	let defaultModel = models[0]?.id ?? 'gpt-5.2-codex';
	try {
		const config = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
		const match = config.match(/^\s*model\s*=\s*"([^"]+)"/m);
		if (match?.[1] && models.some((m) => m.id === match[1])) defaultModel = match[1];
	} catch {
		// No config: keep the first model.
	}
	return { models, defaultModel, source };
}

function sandboxArgs(mode: PermissionMode): string[] {
	switch (mode) {
		case 'acceptEdits':
			return ['--full-auto'];
		case 'bypassPermissions':
			return ['--dangerously-bypass-approvals-and-sandbox'];
		default:
			return ['--sandbox', 'read-only'];
	}
}

interface CodexItem {
	id?: string;
	type?: string;
	text?: string;
	command?: string;
	status?: string;
	exit_code?: number;
	changes?: { path?: string; kind?: string }[];
	server?: string;
	tool?: string;
	query?: string;
}

interface CodexEvent {
	type?: string;
	thread_id?: string;
	item?: CodexItem;
	error?: { message?: string };
	message?: string;
}

/**
 * Runs `codex exec --json` and maps its JSONL event stream onto provider events.
 * Codex exec is non-interactive, so it never asks for input; the sandbox is
 * chosen from the session's permission mode instead.
 */
export class CodexProvider implements Provider {
	readonly id = 'codex' as const;
	readonly label = 'Codex';

	constructor(
		private readonly binary: string,
		private readonly catalogue: CodexModels
	) {}

	async detect(): Promise<ProviderInfo> {
		return {
			id: this.id,
			label: this.label,
			mode: 'live',
			models: this.catalogue.models,
			defaultModel: this.catalogue.defaultModel,
			modelsSource: this.catalogue.source,
			supportsPermissionModes: true,
		};
	}

	run(ctx: RunContext): RunHandle {
		const { session } = ctx;
		// Codex exec takes text only here, so every attached file is named by its saved path.
		const prompt = promptWithFiles(ctx.prompt, ctx.files);
		const args = [
			'exec',
			'--json',
			'--model',
			session.model,
			'--cd',
			session.path,
			'--skip-git-repo-check',
			...sandboxArgs(session.permissionMode),
		];
		if (session.providerSessionId) args.push('resume', session.providerSessionId, prompt);
		else args.push(prompt);

		let child: ChildProcess;
		let finished = false;
		let interrupted = false;
		const finish = (event: Parameters<RunContext['emit']>[0]) => {
			if (finished) return;
			finished = true;
			ctx.emit(event);
		};
		try {
			child = spawn(this.binary, args, {
				cwd: session.path,
				env: process.env,
				stdio: ['ignore', 'pipe', 'pipe'],
			});
		} catch (err) {
			finish({
				type: 'error',
				message: `Could not start codex: ${err instanceof Error ? err.message : String(err)}`,
			});
			return { interrupt: async () => {} };
		}

		let stdoutBuffer = '';
		let stderr = '';
		let sawTurnEnd = false;
		child.stdout?.on('data', (chunk: Buffer) => {
			stdoutBuffer += chunk.toString();
			let newline = stdoutBuffer.indexOf('\n');
			while (newline >= 0) {
				const line = stdoutBuffer.slice(0, newline).trim();
				stdoutBuffer = stdoutBuffer.slice(newline + 1);
				if (line) this.handleLine(ctx, line, () => (sawTurnEnd = true), finish);
				newline = stdoutBuffer.indexOf('\n');
			}
		});
		child.stderr?.on('data', (chunk: Buffer) => {
			stderr += chunk.toString();
			ctx.log(chunk.toString().trimEnd());
		});
		child.on('error', (err) =>
			finish({ type: 'error', message: `codex failed to start: ${err.message}` })
		);
		child.on('close', (code) => {
			if (interrupted) return finish({ type: 'stopped' });
			if (sawTurnEnd) return;
			if (code === 0) return finish({ type: 'done' });
			finish({
				type: 'error',
				message: `codex exited with code ${code}${stderr ? `: ${stderr.trim().slice(-500)}` : ''}`,
			});
		});

		return {
			interrupt: async () => {
				interrupted = true;
				child.kill('SIGINT');
				setTimeout(() => {
					if (child.exitCode === null) child.kill('SIGKILL');
				}, 3000).unref();
			},
		};
	}

	private handleLine(
		ctx: RunContext,
		line: string,
		markTurnEnd: () => void,
		finish: (event: Parameters<RunContext['emit']>[0]) => void
	): void {
		let event: CodexEvent;
		try {
			event = JSON.parse(line) as CodexEvent;
		} catch {
			ctx.log(`codex: ${line}`);
			return;
		}
		switch (event.type) {
			case 'thread.started':
				if (event.thread_id) ctx.emit({ type: 'init', providerSessionId: event.thread_id });
				return;
			case 'item.started':
			case 'item.completed': {
				const item = event.item;
				if (!item) return;
				if (item.type === 'agent_message' && event.type === 'item.completed' && item.text) {
					ctx.emit({ type: 'assistant', text: item.text });
				} else if (
					item.type === 'command_execution' &&
					event.type === 'item.started' &&
					item.command
				) {
					ctx.emit({ type: 'tool', name: 'Shell', summary: item.command });
				} else if (item.type === 'file_change' && event.type === 'item.completed') {
					const files = (item.changes ?? [])
						.map((c) => c.path)
						.filter(Boolean)
						.join(', ');
					ctx.emit({
						type: 'tool',
						name: 'Edit',
						summary: files ? `Changed ${files}` : 'Changed files',
					});
				} else if (item.type === 'mcp_tool_call' && event.type === 'item.started') {
					ctx.emit({
						type: 'tool',
						name: 'MCP',
						summary: `${item.server ?? ''}/${item.tool ?? ''}`.replace(/^\//, ''),
					});
				} else if (item.type === 'web_search' && event.type === 'item.started') {
					ctx.emit({ type: 'tool', name: 'WebSearch', summary: item.query ?? 'Web search' });
				}
				return;
			}
			case 'turn.completed':
				markTurnEnd();
				finish({ type: 'done' });
				return;
			case 'turn.failed':
				markTurnEnd();
				finish({ type: 'error', message: event.error?.message ?? 'Codex turn failed' });
				return;
			case 'error':
				markTurnEnd();
				finish({ type: 'error', message: event.message ?? 'Codex reported an error' });
				return;
			default:
				return;
		}
	}
}
