import { execFile } from 'node:child_process';
import type { ModelOption, ProviderId, ProviderInfo } from '@shared/types';
import type { ServerConfig } from '../config';
import { ClaudeCodeProvider, CLAUDE_FALLBACK_MODELS } from './claude_code';
import { CodexProvider, readCodexModels } from './codex';
import { DemoProvider } from './demo';
import type { Provider } from './types';

export interface ProviderRegistry {
	providers: Map<ProviderId, Provider>;
	infos: ProviderInfo[];
}

function which(binary: string): Promise<string | undefined> {
	return new Promise((resolve) => {
		execFile('which', [binary], { timeout: 3000 }, (err, out) => {
			if (err) return resolve(undefined);
			const found = out.trim();
			resolve(found || undefined);
		});
	});
}

/**
 * Detects which agent CLIs are usable on this machine. Anything that is not
 * becomes a demo provider that says so on every card it powers.
 */
export async function buildProviders(
	config: ServerConfig,
	log: (message: string) => void = console.log
): Promise<ProviderRegistry> {
	const providers = new Map<ProviderId, Provider>();
	const demo = (
		id: ProviderId,
		label: string,
		reason: string,
		models: ModelOption[],
		defaultModel: string,
		modelsSource: string
	) =>
		new DemoProvider({
			id,
			label,
			reason,
			models,
			defaultModel,
			modelsSource,
			turnMs: config.demoTurnMs,
		});

	// Claude Code via the Agent SDK.
	if (config.forceDemo) {
		providers.set(
			'claude-code',
			demo(
				'claude-code',
				'Claude Code',
				'demo mode forced by FORCE_DEMO',
				CLAUDE_FALLBACK_MODELS,
				CLAUDE_FALLBACK_MODELS[0]!.id,
				'built-in fallback list'
			)
		);
	} else {
		const result = await ClaudeCodeProvider.detect(config, log);
		if ('provider' in result) {
			providers.set('claude-code', result.provider);
		} else {
			log(`Claude Code unavailable: ${result.reason}`);
			providers.set(
				'claude-code',
				demo(
					'claude-code',
					'Claude Code',
					result.reason,
					CLAUDE_FALLBACK_MODELS,
					CLAUDE_FALLBACK_MODELS[0]!.id,
					'built-in fallback list'
				)
			);
		}
	}

	// Codex via `codex exec --json`.
	const codexModels = readCodexModels();
	const codexBinary = config.forceDemo ? undefined : await which('codex');
	if (codexBinary) {
		providers.set('codex', new CodexProvider(codexBinary, codexModels));
	} else {
		const reason = config.forceDemo
			? 'demo mode forced by FORCE_DEMO'
			: 'codex CLI is not installed';
		log(`Codex unavailable: ${reason}`);
		providers.set(
			'codex',
			demo(
				'codex',
				'Codex',
				reason,
				codexModels.models,
				codexModels.defaultModel,
				codexModels.source
			)
		);
	}

	const infos = await Promise.all([...providers.values()].map((p) => p.detect()));
	return { providers, infos };
}
