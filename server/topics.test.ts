import { DEFAULT_TOPIC, TOPICS, isTopic, suggestTopic } from '@shared/topics';

describe('topic suggestion', () => {
	it('reads the work from the title and the first prompt', () => {
		expect(
			suggestTopic(
				'RCS beta customer selection',
				'We need to pick ~10 customers for the RCS beta. Can you recommend a shortlist?'
			)
		).toBe('rcs');
		expect(suggestTopic('WABA payment method missing', '')).toBe('whatsapp');
		expect(suggestTopic('SMS sender IDs', 'which message templates use them')).toBe('messaging');
		expect(
			suggestTopic('Metronome conversation', 'Can you check the metronome credit calculation?')
		).toBe('metering');
		expect(
			suggestTopic('Registered MCP servers', 'What MCP servers do we currently have registered?')
		).toBe('ai');
		expect(suggestTopic('WorkOS PII handling in Australia', 'how does it handle PII data')).toBe(
			'legal'
		);
	});

	it('weighs the title above the prompt, and says general when nothing points anywhere', () => {
		expect(
			suggestTopic('Pricing review', 'compare the docs and the readme and the changelog')
		).toBe('pricing');
		expect(suggestTopic('Untitled', 'hello there')).toBe(DEFAULT_TOPIC);
		// Short words match whole words only: "pr" is not "pricing" or "proration".
		expect(suggestTopic('Proration', '')).toBe(DEFAULT_TOPIC);
		expect(suggestTopic('Open a PR', '')).toBe('review');
		expect(suggestTopic('Customers', '')).toBe('customers');
	});

	it('ignores a carried-over summary, pasted blocks, links and attached-file paths', () => {
		const summary =
			'This session is being continued from a previous conversation that ran out of context. pricing invoice billing margin';
		expect(suggestTopic('Rcs-not-yet-supported', summary)).toBe('rcs');
		expect(
			suggestTopic(
				'Untitled',
				'<pasted_content id="a1">pricing invoice billing</pasted_content> see https://example.com/pricing\n\nFiles attached to this message, saved on this machine:\n- /repo/pricing/code.csv'
			)
		).toBe(DEFAULT_TOPIC);
	});

	it('has one entry per id and knows which ids are real', () => {
		expect(new Set(TOPICS.map((t) => t.id)).size).toBe(TOPICS.length);
		expect(isTopic('pricing')).toBe(true);
		expect(isTopic('nope')).toBe(false);
		expect(isTopic(undefined)).toBe(false);
	});
});
