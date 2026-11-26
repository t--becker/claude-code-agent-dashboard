import path from 'node:path';
import type { ChatOutput, OutputKind } from '@shared/types';
import { titleFromFile } from './artifacts';

/**
 * Works out what a chat has produced by watching its tool calls: a call says what it is about
 * to make, its result says whether that worked and where the thing now lives. Only things that
 * exist outside the chat are counted (a page, a ticket, a message, a file, edited code), never
 * lookups.
 */

const FILE_LABELS: Record<string, string> = {
	'.html': 'Web app',
	'.htm': 'Web app',
	'.pdf': 'PDF',
	'.xlsx': 'Spreadsheet',
	'.xls': 'Spreadsheet',
	'.csv': 'Spreadsheet',
	'.docx': 'Document',
	'.pptx': 'Slides',
};

const ARTIFACT_URL = /https:\/\/claude\.ai\/(?:code\/)?artifact\/([A-Za-z0-9_-]+)/;
const MAX_OUTPUTS = 200;
/** A first mention as created, published or opened is kept when the thing is touched again. */
const MADE_IT = new Set(['Created', 'Published', 'Opened']);

interface Pending {
	kind: OutputKind | 'codefile';
	label: string;
	verb: string;
	title?: string;
	url?: string;
	id?: string;
	file?: string;
	/** For a shell command: which address in its output is the thing it made. */
	find?: RegExp;
	ts: number;
}

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const firstLine = (value: string, max = 70) => {
	const line = value.split('\n').find((part) => part.trim()) ?? '';
	const clean = line.replace(/[*_`#>]/g, '').trim();
	return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
};

/** Reads a string value out of JSON text without parsing all of it; the text may be cut short. */
function jsonValue(text: string, key: string): string | undefined {
	const found = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(text);
	if (!found) return undefined;
	try {
		return JSON.parse(`"${found[1]}"`) as string;
	} catch {
		return found[1];
	}
}

const object = (value: unknown): Record<string, unknown> => {
	if (value && typeof value === 'object') return value as Record<string, unknown>;
	if (typeof value !== 'string') return {};
	try {
		const parsed: unknown = JSON.parse(value);
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
};

export class OutputCollector {
	private readonly outputs = new Map<string, ChatOutput>();
	private readonly pending = new Map<string, Pending>();
	/** The Atlassian site this chat talks to, once any call or result has named it. */
	private site: string | undefined;

	constructor(initial: ChatOutput[] = []) {
		for (const output of initial) this.outputs.set(output.key, { ...output });
	}

	list(): ChatOutput[] {
		return [...this.outputs.values()].slice(-MAX_OUTPUTS).map((output) => ({ ...output }));
	}

	/** A tool is about to run. Remembers what it would make, if it makes anything. */
	begin(
		id: string | undefined,
		name: string,
		input: Record<string, unknown> = {},
		ts = Date.now()
	) {
		if (!id) return;
		const made = this.intent(name, input);
		if (made) this.pending.set(id, { ...made, ts });
	}

	/** The tool's result arrived. Returns true when the chat's outputs changed. */
	finish(id: string, result: string, isError = false, ts = Date.now()): boolean {
		const made = this.pending.get(id);
		if (!made) return false;
		this.pending.delete(id);
		this.learnSite(result);
		if (isError || /^\s*\{\s*"error"\s*:\s*true/.test(result)) return false;
		const output = this.settle(made, result, made.ts || ts);
		return output ? this.upsert(output) : false;
	}

	private learnSite(text: string) {
		this.site ??= /https:\/\/([a-z0-9-]+\.atlassian\.net)/i.exec(text)?.[1];
	}

	private intent(name: string, input: Record<string, unknown>): Omit<Pending, 'ts'> | undefined {
		const parts = name.split('__');
		const server = parts.length > 2 ? parts[1]! : '';
		const tool = parts[parts.length - 1]!;
		if (/atlassian\.net$/i.test(str(input.cloudId))) this.site ??= str(input.cloudId);

		if (name === 'Artifact') {
			const action = str(input.action) || 'publish';
			if (action !== 'publish' || input.asset) return undefined;
			const source = str(input.file_path);
			return {
				kind: 'artifact',
				label: 'Artifact',
				verb: input.url ? 'Updated' : 'Published',
				title: str(input.title) || (source ? titleFromFile(source) : ''),
				url: str(input.url),
			};
		}
		if (name === 'Edit' || name === 'MultiEdit' || name === 'NotebookEdit' || name === 'Write') {
			const file = str(input.file_path) || str(input.notebook_path);
			if (!file) return undefined;
			const label = name === 'Write' ? FILE_LABELS[path.extname(file).toLowerCase()] : undefined;
			return label
				? { kind: 'file', label, verb: 'Created', title: path.basename(file), file }
				: { kind: 'codefile', label: '', verb: '', file };
		}
		if (name === 'Bash') {
			const command = str(input.command);
			const title = /--title[= ]+(?:"([^"]+)"|'([^']+)')/.exec(command);
			const named = title?.[1] ?? title?.[2];
			if (/\bgh\s+pr\s+create\b/.test(command))
				return {
					kind: 'pr',
					label: 'Pull request',
					verb: 'Opened',
					title: named,
					find: /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/,
				};
			if (/\bgh\s+issue\s+create\b/.test(command))
				return {
					kind: 'ticket',
					label: 'GitHub issue',
					verb: 'Created',
					title: named,
					find: /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+/,
				};
			if (/\bgh\s+repo\s+create\b/.test(command))
				return {
					kind: 'link',
					label: 'GitHub repository',
					verb: 'Created',
					find: /https:\/\/github\.com\/[\w.-]+\/[\w.-]+/,
				};
			return undefined;
		}
		if (parts.length < 3) return undefined;

		if (/^(create|update)Confluence(Content|Page)$/i.test(tool))
			return {
				kind: 'page',
				label: 'Confluence page',
				verb: /^create/i.test(tool) ? 'Created' : 'Updated',
				title: str(input.title),
				id: str(input.contentId) || str(input.pageId),
			};
		if (/^createJiraIssue$/i.test(tool))
			return { kind: 'ticket', label: 'Jira ticket', verb: 'Created', title: str(input.summary) };
		if (/^(edit|update|transition)JiraIssue$/i.test(tool))
			return { kind: 'ticket', label: 'Jira ticket', verb: 'Updated', id: str(input.issueIdOrKey) };
		if (/^(addOrEditJiraIssueComment|addCommentToJiraIssue)$/i.test(tool))
			return {
				kind: 'ticket',
				label: 'Jira ticket',
				verb: 'Commented',
				id: str(input.issueIdOrKey),
			};

		if (
			(/miro/i.test(server) || str(input.miro_url)) &&
			/^(board_create|canvas_(create|update)_from_svg|image_create)$/.test(tool)
		)
			return {
				kind: 'design',
				label: 'Miro board',
				verb: tool === 'board_create' ? 'Created' : 'Updated',
				title: str(input.name) || str(input.title),
				url: str(input.miro_url),
			};
		if (
			/claude_docs/i.test(server) &&
			(tool === 'batch' || tool === 'update' || tool === 'create')
		) {
			const container = object(input.container);
			const created = object(container.create);
			if (tool === 'batch' && !created.name && !container.id) return undefined;
			return {
				kind: 'doc',
				label: 'Doc',
				verb: created.name || tool === 'create' ? 'Created' : 'Updated',
				title: str(created.name) || str(input.title),
				id: str(container.id),
			};
		}
		if (/slack/i.test(server) || /^slack_/.test(tool)) {
			const text = firstLine(str(input.message) || str(input.text) || str(input.title));
			if (tool === 'slack_send_message')
				return { kind: 'message', label: 'Slack message', verb: 'Sent', title: text };
			if (tool === 'slack_send_message_draft')
				return { kind: 'message', label: 'Slack message', verb: 'Drafted', title: text };
			if (tool === 'slack_schedule_message')
				return { kind: 'message', label: 'Slack message', verb: 'Scheduled', title: text };
			if (/^slack_(create|update)_canvas$/.test(tool))
				return {
					kind: 'doc',
					label: 'Slack canvas',
					verb: tool.includes('create') ? 'Created' : 'Updated',
					title: text,
					id: str(input.canvas_id),
				};
			return undefined;
		}
		if (/posthog/i.test(server) && tool === 'exec') {
			const what =
				/\b(dashboard|insight|notebook|survey|experiment|feature-flag)s?[\w-]*?-(create|update|partial-update)\b/i.exec(
					str(input.command)
				);
			if (!what) return undefined;
			return {
				kind: 'dashboard',
				label: `PostHog ${what[1]!.toLowerCase().replace('-', ' ')}`,
				verb: what[2]!.toLowerCase() === 'create' ? 'Created' : 'Updated',
			};
		}
		if (/^v0$/i.test(server) && tool === 'createChat')
			return {
				kind: 'design',
				label: 'v0 prototype',
				verb: 'Created',
				title: firstLine(str(input.message)),
			};

		// Any other connected tool that says it creates something counts once it answers with
		// an address for what it made.
		if (/^(create|publish|deploy)(?=[A-Z_-]|$)/.test(tool))
			return {
				kind: 'link',
				label: server.replace(/^claude_ai_/i, '').replace(/[_-]+/g, ' '),
				verb: 'Created',
				title: str(input.title) || str(input.name) || str(input.summary),
			};
		return undefined;
	}

	private settle(made: Pending, result: string, ts: number): ChatOutput | undefined {
		const base = { label: made.label, verb: made.verb, ts };
		switch (made.kind) {
			case 'codefile': {
				const files = new Set(this.outputs.get('code')?.files ?? []);
				if (made.file) files.add(made.file);
				return {
					key: 'code',
					kind: 'code',
					title: 'Code changes',
					label: `${files.size} file${files.size === 1 ? '' : 's'}`,
					verb: 'View diff',
					files: [...files],
					ts,
				};
			}
			case 'file':
				return {
					...base,
					key: `file:${made.file}`,
					kind: 'file',
					title: made.title!,
					file: made.file,
				};
			case 'artifact': {
				if (/refused|nothing was published/i.test(result.slice(0, 300))) return undefined;
				const id = (ARTIFACT_URL.exec(made.url ?? '') ?? ARTIFACT_URL.exec(result))?.[1];
				if (!id) return undefined;
				return {
					...base,
					key: `artifact:${id}`,
					kind: 'artifact',
					title: made.title || 'Published page',
					url: `https://claude.ai/artifact/${id}`,
				};
			}
			case 'page': {
				const id = made.id || jsonValue(result, 'id');
				const web = jsonValue(result, 'webui');
				const root =
					jsonValue(result, 'base') ?? (this.site ? `https://${this.site}/wiki` : undefined);
				return {
					...base,
					key: `page:${id ?? made.title}`,
					kind: 'page',
					title: jsonValue(result, 'title') || made.title || 'Confluence page',
					url:
						root && web
							? `${root}${web}`
							: root && id
								? `${root}/pages/viewpage.action?pageId=${id}`
								: undefined,
				};
			}
			case 'ticket': {
				if (made.find) {
					const url = made.find.exec(result)?.[0];
					if (!url) return undefined;
					const number = /\d+$/.exec(url)?.[0];
					return {
						...base,
						key: `ticket:${url}`,
						kind: 'ticket',
						title: made.title || `Issue #${number}`,
						url,
					};
				}
				const key = made.id || /"key"\s*:\s*"([A-Z][A-Z0-9_]*-\d+)"/.exec(result)?.[1];
				if (!key) return undefined;
				const summary = made.title || jsonValue(result, 'summary');
				return {
					...base,
					key: `ticket:${key}`,
					kind: 'ticket',
					title: summary ? `${key} ${summary}` : key,
					url: this.site ? `https://${this.site}/browse/${key}` : undefined,
				};
			}
			case 'pr': {
				const url = made.find?.exec(result)?.[0];
				if (!url) return undefined;
				return {
					...base,
					key: `pr:${url}`,
					kind: 'pr',
					title: made.title || `Pull request #${/\d+$/.exec(url)?.[0]}`,
					url,
				};
			}
			case 'design': {
				const url =
					made.url ||
					/https:\/\/miro\.com\/app\/board\/[^\s"\\]+/.exec(result)?.[0] ||
					jsonValue(result, 'url');
				return {
					...base,
					key: `design:${url ?? made.title}`,
					kind: 'design',
					title: made.title || jsonValue(result, 'name') || made.label,
					url,
				};
			}
			case 'doc': {
				const url =
					ARTIFACT_URL.exec(result)?.[0] ??
					jsonValue(result, 'canvas_url') ??
					jsonValue(result, 'url');
				return {
					...base,
					key: `doc:${made.id || url || made.title}`,
					kind: 'doc',
					title: made.title || jsonValue(result, 'title') || made.label,
					url,
				};
			}
			case 'message': {
				const url =
					jsonValue(result, 'message_link') ??
					jsonValue(result, 'permalink') ??
					jsonValue(result, 'channel_link');
				return {
					...base,
					key: `message:${ts}:${made.title}`,
					kind: 'message',
					title: made.title || made.label,
					url,
				};
			}
			case 'dashboard': {
				const url = /https:\/\/[\w.-]*posthog\.com\/[^\s"\\)]+/.exec(result)?.[0];
				const title = jsonValue(result, 'name') ?? jsonValue(result, 'title');
				if (!url && !title) return undefined;
				return {
					...base,
					key: `dashboard:${url ?? title}`,
					kind: 'dashboard',
					title: title || made.label,
					url,
				};
			}
			case 'link': {
				const url = made.find
					? made.find.exec(result)?.[0]
					: [...result.matchAll(/https?:\/\/[^\s"'\\)>]+/g)]
							.map((found) => found[0])
							.find((address) => !/schema\.org|json-schema|w3\.org/.test(address));
				if (!url) return undefined;
				return {
					...base,
					key: `link:${url}`,
					kind: 'link',
					title: made.title || url.replace(/^https?:\/\//, ''),
					url,
				};
			}
			default:
				return undefined;
		}
	}

	private upsert(next: ChatOutput): boolean {
		const seen = this.outputs.get(next.key);
		if (!seen) {
			this.outputs.set(next.key, next);
			return true;
		}
		const merged: ChatOutput = {
			...seen,
			...next,
			// Something this chat made stays "Created", however often it is touched afterwards.
			verb: MADE_IT.has(seen.verb) ? seen.verb : next.verb,
			title: next.kind === 'artifact' || !next.title ? seen.title || next.title : next.title,
			url: next.url ?? seen.url,
		};
		const changed = JSON.stringify(merged) !== JSON.stringify(seen);
		this.outputs.set(next.key, merged);
		return changed;
	}
}
