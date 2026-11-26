import type { PendingOption, ProviderId, ProviderInfo, Session } from '@shared/types';
import type { SavedFile } from '../attachments';

export type ProviderEvent =
	| { type: 'init'; providerSessionId: string }
	| { type: 'stream'; text: string }
	/** A status label for the current step ("Thinking", "Running Bash"); never model output. */
	| { type: 'activity'; label: string }
	| { type: 'assistant'; text: string }
	| {
			type: 'tool';
			name: string;
			summary: string;
			toolUseId?: string;
			diff?: string;
			/** What the tool was asked, for working out what the chat produces. Never saved. */
			input?: Record<string, unknown>;
	  }
	| { type: 'tool_result'; toolUseId: string; output: string; isError?: boolean; full?: string }
	| { type: 'done'; costUsd?: number }
	| { type: 'error'; message: string }
	| { type: 'stopped' };

export interface AskRequest {
	kind: 'permission' | 'question';
	title: string;
	detail?: string;
	toolName?: string;
	options: PendingOption[];
	allowFreeText: boolean;
}

export interface AskAnswer {
	optionId?: string;
	text?: string;
}

/** Answer the manager returns when the user stops a session that is waiting on input. */
export const STOPPED_ANSWER = '__stopped__';

export interface RunContext {
	session: Session;
	prompt: string;
	/** Files sent with the prompt, already saved on this machine. */
	files?: SavedFile[];
	/** This agent's attachments folder, which it must be able to read. */
	attachmentsDir?: string;
	emit(event: ProviderEvent): void;
	ask(request: AskRequest): Promise<AskAnswer>;
	log(message: string): void;
}

export interface RunHandle {
	interrupt(): Promise<void>;
}

export interface Provider {
	readonly id: ProviderId;
	readonly label: string;
	detect(): Promise<ProviderInfo>;
	run(ctx: RunContext): RunHandle;
}

/** Adds the saved paths of attached files to the prompt, for the agent to open with its own tools. */
export function promptWithFiles(text: string, files: SavedFile[] = []): string {
	if (!files.length) return text;
	const list = files.map((file) => `- ${file.path}`).join('\n');
	return `${text}\n\nFiles attached to this message, saved on this machine. Read them as needed:\n${list}`.trim();
}

/** Accumulates streamed text and forwards it at most every `intervalMs`. */
export function makeStreamer(ctx: RunContext, intervalMs = 120) {
	let buffer = '';
	let timer: NodeJS.Timeout | undefined;
	const flush = () => {
		timer = undefined;
		if (buffer) ctx.emit({ type: 'stream', text: buffer });
	};
	return {
		push(delta: string) {
			buffer += delta;
			if (!timer) timer = setTimeout(flush, intervalMs);
		},
		/** Returns the full text seen since the last reset. */
		take(): string {
			if (timer) clearTimeout(timer);
			timer = undefined;
			const text = buffer;
			buffer = '';
			return text;
		},
		cancel() {
			if (timer) clearTimeout(timer);
			timer = undefined;
			buffer = '';
		},
	};
}
