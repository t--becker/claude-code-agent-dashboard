import { defineConfig, devices } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

// The e2e suite runs against the demo provider only: deterministic, free, and
// independent of which agent CLIs are installed on the machine running it.
const port = 4877;
const dataDir = path.join(import.meta.dirname, 'test-results', 'e2e-data');
// Outside this project on purpose: the sample folders must not sit inside a git repo, or their
// cards would show this repo's branch instead of "no git".
const repoRoot = path.join(os.tmpdir(), 'agent-workspace-e2e-repos');
// A stand-in for Claude Code's own folder, holding one sample chat for the artifact library.
const claudeDir = path.join(os.tmpdir(), 'agent-workspace-e2e-claude');

export default defineConfig({
	testDir: './e2e',
	fullyParallel: false,
	workers: 1,
	retries: 0,
	reporter: [['list']],
	use: {
		baseURL: `http://127.0.0.1:${port}`,
		trace: 'retain-on-failure',
		...devices['Desktop Chrome'],
		// The installed Google Chrome, so no Playwright browser download is needed on this machine.
		channel: 'chrome',
	},
	webServer: {
		command: [
			`rm -rf ${dataDir} ${repoRoot} ${claudeDir}`,
			`mkdir -p ${repoRoot}/alpha ${repoRoot}/beta`,
			`node e2e/seed.mjs ${repoRoot} ${claudeDir} ${dataDir}`,
			'npm run build',
			`PORT=${port} DATA_DIR=${dataDir} REPO_ROOT=${repoRoot} CLAUDE_CONFIG_DIR=${claudeDir} FORCE_DEMO=1 FOLDER_PICKER=off DEMO_TURN_MS=500 npm start`,
		].join(' && '),
		url: `http://127.0.0.1:${port}/api/health`,
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
