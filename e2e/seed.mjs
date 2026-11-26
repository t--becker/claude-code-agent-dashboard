// Sample data for the browser tests: one saved chat in which an agent published a page, pointed
// to a spreadsheet, and published then deleted another page; plus the files it refers to.
import fs from 'node:fs';
import path from 'node:path';

const [repoRoot, claudeDir] = process.argv.slice(2);
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
