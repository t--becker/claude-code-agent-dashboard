import { OutputCollector } from './outputs';

const run = (
	collector: OutputCollector,
	id: string,
	name: string,
	input: Record<string, unknown>,
	result: string,
	isError = false
) => {
	collector.begin(id, name, input, 1000);
	return collector.finish(id, result, isError, 2000);
};

describe('what a chat produced', () => {
	it('lists a published page once, however often it is republished', () => {
		const outputs = new OutputCollector();
		expect(
			run(
				outputs,
				'a',
				'Artifact',
				{ file_path: '/work/billing-map.html' },
				'Published /work/billing-map.html at https://claude.ai/artifact/Map01 (Version 1)'
			)
		).toBe(true);
		run(
			outputs,
			'b',
			'Artifact',
			{ file_path: '/work/billing-map.html', url: 'https://claude.ai/artifact/Map01' },
			'Published (Version 2)'
		);
		// A refused publish, a failed one and an asset upload add nothing.
		expect(
			run(
				outputs,
				'c',
				'Artifact',
				{ file_path: '/work/x.html' },
				'Publish refused — nothing was merged'
			)
		).toBe(false);
		expect(run(outputs, 'd', 'Artifact', { file_path: '/work/y.html' }, 'boom', true)).toBe(false);
		run(
			outputs,
			'e',
			'Artifact',
			{ file_path: '/work/d.json', url: 'https://claude.ai/artifact/Map01', asset: true },
			'Asset uploaded'
		);
		run(
			outputs,
			'f',
			'Artifact',
			{ action: 'read', url: 'https://claude.ai/artifact/Other' },
			'page text'
		);
		expect(outputs.list()).toEqual([
			{
				key: 'artifact:Map01',
				kind: 'artifact',
				title: 'Billing map',
				label: 'Artifact',
				verb: 'Published',
				url: 'https://claude.ai/artifact/Map01',
				ts: 1000,
			},
		]);
	});

	it('finds pages and tickets made through a connected tool, with a link once the site is known', () => {
		const outputs = new OutputCollector();
		run(
			outputs,
			'a',
			'mcp__tracker__createJiraIssue',
			{ cloudId: 'abc-123', summary: 'Fix the status refresh' },
			'{"data":{"id":"9","key":"OPS-12"}}'
		);
		// No site named yet: the ticket is listed, without a link.
		expect(outputs.list()[0]).toMatchObject({
			key: 'ticket:OPS-12',
			title: 'OPS-12 Fix the status refresh',
			verb: 'Created',
			url: undefined,
		});

		run(
			outputs,
			'b',
			'mcp__tracker__updateConfluenceContent',
			{ contentId: '555' },
			'{"data":{"ok":true,"content":{"id":"555","title":"Onboarding \\"guide\\"","_links":{"base":"https://example.atlassian.net/wiki","webui":"/spaces/OPS/pages/555"}}}}'
		);
		run(
			outputs,
			'c',
			'mcp__tracker__editJiraIssue',
			{ issueIdOrKey: 'OPS-12' },
			'{"data":{"key":"OPS-12","fields":{"summary":"Fix the status refresh"}}}'
		);
		run(
			outputs,
			'd',
			'mcp__tracker__getJiraIssue',
			{ issueIdOrKey: 'OPS-99' },
			'{"data":{"key":"OPS-99"}}'
		);
		expect(outputs.list().map((o) => [o.label, o.verb, o.title, o.url])).toEqual([
			// Made by this chat, so it stays "Created" after the later edit, and gains its link.
			[
				'Jira ticket',
				'Created',
				'OPS-12 Fix the status refresh',
				'https://example.atlassian.net/browse/OPS-12',
			],
			[
				'Confluence page',
				'Updated',
				'Onboarding "guide"',
				'https://example.atlassian.net/wiki/spaces/OPS/pages/555',
			],
		]);
	});

	it('groups edited files as code changes and lists a written deliverable on its own', () => {
		const outputs = new OutputCollector();
		run(outputs, 'a', 'Edit', { file_path: '/work/src/app.ts' }, 'updated');
		run(outputs, 'b', 'Write', { file_path: '/work/src/new.ts' }, 'created');
		run(outputs, 'c', 'Edit', { file_path: '/work/src/app.ts' }, 'updated');
		run(outputs, 'd', 'Write', { file_path: '/work/out/checkout.html' }, 'created');
		run(outputs, 'e', 'Edit', { file_path: '/work/src/broken.ts' }, 'no match', true);
		expect(outputs.list()).toEqual([
			{
				key: 'code',
				kind: 'code',
				title: 'Code changes',
				label: '2 files',
				verb: 'View diff',
				files: ['/work/src/app.ts', '/work/src/new.ts'],
				ts: 1000,
			},
			{
				key: 'file:/work/out/checkout.html',
				kind: 'file',
				title: 'checkout.html',
				label: 'Web app',
				verb: 'Created',
				file: '/work/out/checkout.html',
				ts: 1000,
			},
		]);
	});

	it('picks up pull requests, messages and other tools that answer with an address', () => {
		const outputs = new OutputCollector();
		run(
			outputs,
			'a',
			'Bash',
			{ command: 'gh pr create --title "Add promo banner" --body x' },
			'https://github.com/acme/shop/pull/42\n'
		);
		run(outputs, 'b', 'Bash', { command: 'npm test' }, 'see https://github.com/acme/shop/pull/1');
		run(
			outputs,
			'c',
			'mcp__chat__slack_send_message',
			{ channel_id: 'C1', message: '**Release** is out\nmore' },
			'{"message_link":"https:\\/\\/acme.slack.com\\/archives\\/C1\\/p1"}'
		);
		run(
			outputs,
			'd',
			'mcp__boards__canvas_update_from_svg',
			{ miro_url: 'https://miro.com/app/board/abc=/' },
			'{"success":true}'
		);
		run(
			outputs,
			'e',
			'mcp__forms__createSurvey',
			{ title: 'Beta feedback' },
			'{"url":"https://forms.example.com/s/1"}'
		);
		run(outputs, 'f', 'mcp__senders__create_sender', { name: 'x' }, '{"status":"PENDING"}');
		expect(outputs.list().map((o) => [o.kind, o.label, o.verb, o.title, o.url])).toEqual([
			['pr', 'Pull request', 'Opened', 'Add promo banner', 'https://github.com/acme/shop/pull/42'],
			[
				'message',
				'Slack message',
				'Sent',
				'Release is out',
				'https://acme.slack.com/archives/C1/p1',
			],
			['design', 'Miro board', 'Updated', 'Miro board', 'https://miro.com/app/board/abc=/'],
			['link', 'forms', 'Created', 'Beta feedback', 'https://forms.example.com/s/1'],
		]);
	});

	it('carries on from what a chat had already produced', () => {
		const first = new OutputCollector();
		run(first, 'a', 'Edit', { file_path: '/work/a.ts' }, 'ok');
		const later = new OutputCollector(first.list());
		run(later, 'b', 'Edit', { file_path: '/work/b.ts' }, 'ok');
		expect(later.list()[0]).toMatchObject({
			label: '2 files',
			files: ['/work/a.ts', '/work/b.ts'],
		});
		// A result with no matching call changes nothing.
		expect(later.finish('unknown', 'x')).toBe(false);
	});
});
