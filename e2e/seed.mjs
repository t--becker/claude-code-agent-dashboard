// Sample data for the browser tests: one saved chat in which an agent published a page, pointed
// to a spreadsheet, and published then deleted another page; plus the files it refers to.
import fs from 'node:fs';
import path from 'node:path';

const [repoRoot, claudeDir, dataDir] = process.argv.slice(2);
const project = path.join(repoRoot, 'alpha');
fs.mkdirSync(project, { recursive: true });
fs.writeFileSync(
	path.join(project, 'checkout.html'),
	'<!doctype html><title>Checkout prototype</title><h1>One-page checkout</h1>'
);
fs.writeFileSync(path.join(project, 'rates.csv'), 'country,rate\nAU,0.049\nNZ,0.071\n');

const at = (minute) => new Date(Date.UTC(2026, 0, 5, 9, minute)).toISOString();
const says = (minute, content) => ({
	type: 'assistant',
	uuid: `a${minute}`,
	timestamp: at(minute),
	cwd: project,
	message: { role: 'assistant', content },
});
const result = (minute, id, text) => ({
	type: 'user',
	uuid: `u${minute}`,
	timestamp: at(minute),
	cwd: project,
	message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] },
});
const publish = (id, input) => [{ type: 'tool_use', id, name: 'Artifact', input }];

const lines = [
	says(1, publish('t1', { file_path: path.join(project, 'checkout.html') })),
	result(
		2,
		't1',
		`Published ${project}/checkout.html at https://claude.ai/artifact/SampleCheckout01 (Version 1)`
	),
	says(3, [{ type: 'text', text: 'The comparison is in [rates.csv](rates.csv).' }]),
	says(4, publish('t2', { file_path: path.join(project, 'gone.html') })),
	result(
		5,
		't2',
		`Published ${project}/gone.html at https://claude.ai/artifact/SampleGone02 (Version 1)`
	),
	says(6, publish('t3', { action: 'delete', url: 'https://claude.ai/artifact/SampleGone02' })),
	result(7, 't3', 'Deleted.'),
];
const chats = path.join(claudeDir, 'projects', '-sample-alpha');
fs.mkdirSync(chats, { recursive: true });
fs.writeFileSync(
	path.join(chats, 'sample-chat.jsonl'),
	lines.map((line) => JSON.stringify(line)).join('\n') + '\n'
);

// A chat long enough that the page shows only its tail: the case where following new messages
// is hardest, because an old message leaves the top each time a new one arrives at the bottom.
const started = Date.UTC(2026, 0, 6, 9, 0);
const transcript = Array.from({ length: 220 }, (_, n) => ({
	id: `long-${n}`,
	ts: started + n * 60_000,
	kind: n % 2 ? 'assistant' : 'user',
	text:
		n % 2
			? `Reply ${n}: here is a longer answer that runs over a few lines so the chat is tall. `.repeat(
					3
				)
			: `Question ${n}`,
}));
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(
	path.join(dataDir, 'sessions.json'),
	JSON.stringify({
		version: 1,
		sessions: [
			{
				id: 'long-history',
				title: 'Long history',
				project: 'alpha',
				path: project,
				branch: 'no git',
				provider: 'claude-code',
				providerLabel: 'Claude Code',
				providerMode: 'demo',
				model: 'default',
				permissionMode: 'default',
				state: 'Done',
				closed: false,
				createdAt: started,
				updatedAt: started + 220 * 60_000,
				turns: 110,
				icon: 'general',
				iconChosen: true,
				transcript,
			},
		],
	})
);
