import { randomUUID } from 'node:crypto';
import type { ModelOption, ProviderId, ProviderInfo } from '@shared/types';
import { STOPPED_ANSWER, type Provider, type RunContext, type RunHandle } from './types';

/** Says what arrived with the prompt, so a demo turn shows attachments reached the agent. */
function received(ctx: RunContext): string {
	const pictures = ctx.files?.filter((file) => file.imageData).length ?? 0;
	const others = (ctx.files?.length ?? 0) - pictures;
	const count = (n: number, word: string) =>
		n ? `${n} attached ${word}${n === 1 ? '' : 's'}` : '';
	const parts = [count(pictures, 'image'), count(others, 'file')].filter(Boolean);
	return parts.length ? ` I received ${parts.join(' and ')}.` : '';
}

export interface DemoProviderOptions {
	id: ProviderId;
	label: string;
	reason: string;
	models: ModelOption[];
	defaultModel: string;
	modelsSource: string;
	turnMs: number;
}

/**
 * Stand-in used when a real agent CLI is unavailable. Every response it
 * produces says so, and it never touches the project folder.
 */
export class DemoProvider implements Provider {
	readonly id: ProviderId;
	readonly label: string;

	constructor(private readonly options: DemoProviderOptions) {
		this.id = options.id;
		this.label = options.label;
	}

	async detect(): Promise<ProviderInfo> {
		const { id, label, reason, models, defaultModel, modelsSource } = this.options;
		return {
			id,
			label,
			mode: 'demo',
			reason,
			models,
			defaultModel,
			modelsSource,
			supportsPermissionModes: id === 'claude-code',
		};
	}

	run(ctx: RunContext): RunHandle {
		let cancelled = false;
		const wakers = new Set<() => void>();
		const sleep = (ms: number) =>
			new Promise<void>((resolve) => {
				const timer = setTimeout(() => {
					wakers.delete(wake);
					resolve();
				}, ms);
				const wake = () => {
					clearTimeout(timer);
					resolve();
				};
				wakers.add(wake);
			});
		const step = Math.max(20, this.options.turnMs / 6);

		const turn = async () => {
			ctx.emit({
				type: 'init',
				providerSessionId: ctx.session.providerSessionId ?? `demo-${randomUUID()}`,
			});
			await sleep(step);
			if (cancelled) return;
			ctx.emit({
				type: 'tool',
				name: 'Read',
				summary: `Read the ${ctx.session.project} project layout`,
			});
			await sleep(step);
			if (cancelled) return;
			ctx.emit({
				type: 'tool',
				name: 'Grep',
				summary: 'Searched for the references the prompt mentions',
			});
			await sleep(step);
			if (cancelled) return;
			// "outputs" in the prompt makes the simulated agent produce some: an edit, a ticket, a page.
			if (/\boutputs?\b/i.test(ctx.prompt)) {
				const made: [
					name: string,
					summary: string,
					input: Record<string, unknown>,
					result: string,
					diff?: string,
				][] = [
					[
						'Edit',
						'src/app.ts',
						{ file_path: 'src/app.ts' },
						'The file was updated.',
						"- const title = 'Old';\n+ const title = 'New';",
					],
					[
						'mcp__tracker__createJiraIssue',
						'Create a ticket',
						{ cloudId: 'example.atlassian.net', summary: 'Fix the status refresh' },
						'{"data":{"id":"1","key":"DEMO-7"}}',
					],
					[
						'Artifact',
						'Publish the summary page',
						{ file_path: 'summary-page.html', title: 'Summary page' },
						'Published summary-page.html at https://claude.ai/artifact/DemoSummary01 (Version 1)',
					],
				];
				for (const [name, summary, input, result, diff] of made) {
					const toolUseId = `demo-${randomUUID()}`;
					ctx.emit({ type: 'tool', name, summary, toolUseId, input, diff });
					ctx.emit({ type: 'tool_result', toolUseId, output: result });
				}
				await sleep(step);
				if (cancelled) return;
			}
			// "usage limit" in the prompt answers the way Claude Code does when a model has run out.
			if (/\busage limit\b/i.test(ctx.prompt)) {
				ctx.emit({
					type: 'assistant',
					text: "You've reached your Fable limit. Switch to another model to continue.",
				});
				ctx.emit({ type: 'done' });
				return;
			}
			if (/\bfail\b/i.test(ctx.prompt)) {
				ctx.emit({ type: 'error', message: 'Demo failure requested by the prompt.' });
				return;
			}

			let decision = '';
			if (/\bdecide\b/i.test(ctx.prompt)) {
				const answer = await ctx.ask({
					kind: 'question',
					title: 'Should this change include the extended option, or stay minimal?',
					options: [
						{ id: 'extended', label: 'Include the extended option' },
						{ id: 'minimal', label: 'Keep it minimal' },
					],
					allowFreeText: true,
				});
				if (cancelled || answer.optionId === STOPPED_ANSWER) return;
				decision = answer.text?.trim() || answer.optionId || 'minimal';
				ctx.emit({ type: 'tool', name: 'Edit', summary: `Applied the ${decision} change` });
				await sleep(step);
				if (cancelled) return;
			}

			const summary = ctx.prompt.length > 80 ? `${ctx.prompt.slice(0, 77)}…` : ctx.prompt;
			const text =
				`Demo mode: ${this.label} is not connected (${this.options.reason}). ` +
				`I simulated a turn for “${summary}” in ${ctx.session.path} and changed nothing on disk.` +
				received(ctx) +
				(decision ? ` You chose: ${decision}.` : '');
			const words = text.split(' ');
			let soFar = '';
			const chunk = Math.ceil(words.length / 3);
			for (let i = 0; i < words.length; i += chunk) {
				soFar += (soFar ? ' ' : '') + words.slice(i, i + chunk).join(' ');
				ctx.emit({ type: 'stream', text: soFar });
				await sleep(step / 2);
				if (cancelled) return;
			}
			ctx.emit({ type: 'assistant', text });
			ctx.emit({ type: 'done', costUsd: 0 });
		};

		turn().catch((err: unknown) => {
			if (!cancelled)
				ctx.emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
		});

		return {
			interrupt: async () => {
				cancelled = true;
				for (const wake of wakers) wake();
				wakers.clear();
				ctx.emit({ type: 'stopped' });
			},
		};
	}
}
