// The topic icon beside a chat's title. The suggestion comes from what the chat is about (its
// title and the first thing asked of it), never from the repo: unrelated chats share a repo.

export interface Topic {
	id: string;
	label: string;
	/**
	 * Words that point at this topic. A word matches the start of a word in the text ("customer"
	 * matches "customers"); words of three letters or fewer must match exactly ("pr" is not
	 * "pricing"). A phrase with a space matches as written.
	 */
	keywords: string[];
}

/** Earlier topics win a tie, so the more specific ones come first. */
export const TOPICS: Topic[] = [
	// The two channels most chats are about get their own logos, ahead of every general topic.
	{ id: 'rcs', label: 'RCS', keywords: ['rcs', 'rbm', 'rich communication'] },
	{ id: 'whatsapp', label: 'WhatsApp', keywords: ['whatsapp', 'waba', 'whats app'] },
	{
		id: 'metering',
		label: 'Metering',
		keywords: ['metronome', 'metering', 'meter', 'usage event'],
	},
	{
		id: 'ai',
		label: 'AI and agents',
		keywords: [
			'mcp',
			'agent',
			'bot',
			'ai',
			'llm',
			'claude',
			'codex',
			'assistant',
			'skill',
			'plugin',
			'chatbot',
			'prompt',
		],
	},
	{
		id: 'security',
		label: 'Security and access',
		keywords: [
			'security',
			'insecure',
			'auth',
			'oauth',
			'token',
			'secret',
			'credential',
			'vulnerab',
			'permission',
			'api key',
			'sso',
		],
	},
	{
		id: 'tests',
		label: 'Tests',
		keywords: ['test', 'e2e', 'playwright', 'vitest', 'qa', 'regression', 'coverage'],
	},
	{
		id: 'bug',
		label: 'Bug hunt',
		keywords: [
			'bug',
			'fix',
			'error',
			'failing',
			'fails',
			'broken',
			'crash',
			'debug',
			'incident',
			'not working',
			'wrong',
			'unknown',
		],
	},
	{
		id: 'pricing',
		label: 'Pricing and billing',
		keywords: [
			'pricing',
			'price',
			'margin',
			'cost',
			'invoice',
			'billing',
			'rate card',
			'credit',
			'revenue',
			'discount',
			'charge',
			'payment',
			'stripe',
		],
	},
	{
		id: 'review',
		label: 'Code review',
		keywords: ['review', 'pr', 'pull request', 'merge', 'commit', 'diff', 'rebase', 'branch'],
	},
	{
		id: 'legal',
		label: 'Compliance',
		keywords: [
			'compliance',
			'legal',
			'policy',
			'terms',
			'gdpr',
			'consent',
			'opt-out',
			'privacy',
			'pii',
			'data residency',
			'contract',
		],
	},
	{
		id: 'slides',
		label: 'Presentation',
		keywords: ['deck', 'slide', 'presentation', 'pitch', 'keynote'],
	},
	{
		id: 'sheet',
		label: 'Spreadsheet',
		keywords: ['csv', 'spreadsheet', 'xlsx', 'excel', 'sheet', 'export', 'pivot'],
	},
	{
		id: 'data',
		label: 'Data and reporting',
		keywords: [
			'report',
			'dashboard',
			'analytics',
			'metric',
			'bigquery',
			'sql',
			'query',
			'posthog',
			'grafana',
			'chart',
			'kpi',
			'trend',
			'funnel',
		],
	},
	{
		id: 'database',
		label: 'Database',
		keywords: ['database', 'db', 'postgres', 'mysql', 'table', 'replica', 'migration', 'schema'],
	},
	{
		id: 'api',
		label: 'API and integrations',
		keywords: [
			'api',
			'endpoint',
			'webhook',
			'integration',
			'swagger',
			'openapi',
			'sdk',
			'connector',
			'callback',
		],
	},
	{
		id: 'docs',
		label: 'Docs and writing',
		keywords: [
			'doc',
			'readme',
			'confluence',
			'poster',
			'write-up',
			'changelog',
			'spec',
			'rfc',
			'draft',
			'article',
			'blog',
			'guide',
			'copy',
		],
	},
	{
		id: 'planning',
		label: 'Planning',
		keywords: [
			'plan',
			'roadmap',
			'epic',
			'jira',
			'ticket',
			'backlog',
			'sprint',
			'story',
			'priorit',
			'milestone',
			'scope',
			'requirements',
		],
	},
	{
		id: 'email',
		label: 'Email',
		keywords: ['email', 'gmail', 'inbox', 'mail', 'newsletter'],
	},
	{
		id: 'calendar',
		label: 'Schedule',
		keywords: [
			'schedule',
			'meeting',
			'calendar',
			'agenda',
			'eod',
			'standup',
			'deadline',
			'reminder',
		],
	},
	{
		id: 'design',
		label: 'Design',
		keywords: [
			'design',
			'ui',
			'ux',
			'mockup',
			'facelift',
			'layout',
			'css',
			'style',
			'icon',
			'prototype',
			'wireframe',
			'theme',
		],
	},
	{
		id: 'media',
		label: 'Images and media',
		keywords: ['image', 'picture', 'screenshot', 'carousel', 'media', 'video', 'photo', 'logo'],
	},
	{
		id: 'launch',
		label: 'Release',
		keywords: ['deploy', 'release', 'publish', 'launch', 'ship', 'rollout', 'go-live', 'go live'],
	},
	{
		id: 'infra',
		label: 'Infrastructure',
		keywords: [
			'infra',
			'server',
			'kubernetes',
			'docker',
			'pipeline',
			'ci',
			'cloud',
			'gcp',
			'aws',
			'dns',
			'hosting',
		],
	},
	{
		id: 'campaign',
		label: 'Campaign',
		keywords: [
			'campaign',
			'broadcast',
			'promo',
			'marketing',
			'blast',
			'sale',
			'audience',
			'segment',
		],
	},
	{
		id: 'messaging',
		label: 'Messaging',
		keywords: ['sms', 'mms', 'message', 'messaging', 'chat', 'conversation', 'template', 'sender'],
	},
	{
		id: 'customers',
		label: 'Customers',
		keywords: [
			'customer',
			'client',
			'account',
			'user',
			'onboard',
			'partner',
			'prospect',
			'reseller',
			'tenant',
			'pilot',
		],
	},
	{
		id: 'phone',
		label: 'Numbers and devices',
		keywords: ['phone', 'number', 'device', 'mobile', 'handset', 'sim'],
	},
	{
		id: 'world',
		label: 'Markets',
		keywords: [
			'country',
			'international',
			'region',
			'market',
			'locali',
			'i18n',
			'translation',
			'timezone',
			'uk',
			'usa',
		],
	},
	{
		id: 'link',
		label: 'Links',
		keywords: ['link', 'url', 'redirect', 'tracking', 'shortener', 'domain'],
	},
	{
		id: 'files',
		label: 'Files',
		keywords: [
			'file',
			'folder',
			'organise',
			'organize',
			'cleanup',
			'clean up',
			'move',
			'archive',
			'backup',
		],
	},
	{
		id: 'setup',
		label: 'Setup and tooling',
		keywords: [
			'config',
			'setup',
			'set up',
			'install',
			'settings',
			'environment',
			'tooling',
			'upgrade',
			'vscode',
			'cli',
		],
	},
	{
		id: 'research',
		label: 'Research',
		keywords: [
			'research',
			'compare',
			'investigat',
			'competitor',
			'evaluat',
			'discovery',
			'explore',
			'find out',
			'analysis',
			'analyse',
			'analyze',
		],
	},
	{
		id: 'learn',
		label: 'Explainer',
		keywords: [
			'explain',
			'learn',
			'how does',
			'how do',
			'teach',
			'tutorial',
			'walkthrough',
			'understand',
			'what is',
		],
	},
	{
		id: 'idea',
		label: 'Idea',
		keywords: ['idea', 'brainstorm', 'innovation', 'concept', 'what if', 'proposal'],
	},
	{
		id: 'code',
		label: 'Code',
		keywords: [
			'code',
			'refactor',
			'implement',
			'function',
			'build',
			'feature',
			'typescript',
			'python',
			'script',
			'component',
			'repo',
		],
	},
	{ id: 'general', label: 'General', keywords: [] },
];

export const DEFAULT_TOPIC = 'general';

const KNOWN = new Set(TOPICS.map((topic) => topic.id));

export const isTopic = (id: unknown): id is string => typeof id === 'string' && KNOWN.has(id);

export const topicLabel = (id: string): string =>
	TOPICS.find((topic) => topic.id === id)?.label ?? 'General';

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const matchers = TOPICS.map((topic) => ({
	id: topic.id,
	tests: topic.keywords.map((keyword) =>
		keyword.length <= 3
			? new RegExp(`(?<![\\p{L}\\p{N}])${escape(keyword)}(?![\\p{L}\\p{N}])`, 'iu')
			: new RegExp(`(?<![\\p{L}\\p{N}])${escape(keyword)}`, 'iu')
	),
}));

/** How much of the first prompt is read: its opening says what the chat is for. */
const PROMPT_CHARS = 400;
/** A word in the title says more about the chat than the same word in the prompt. */
const TITLE_WEIGHT = 3;

/**
 * The part of a first prompt that says what the chat is for. A chat carried over from an earlier
 * one opens with a long summary of everything before it, which points everywhere at once, so
 * that is left out and the title decides. Pasted blocks and attached-file paths are dropped too.
 */
function openingOf(firstPrompt: string): string {
	if (/^\s*This session is being continued from a previous conversation/i.test(firstPrompt))
		return '';
	return firstPrompt
		.split('\n\nFiles attached to this message')[0]!
		.replace(/<([\w-]+)[^>]*>[\s\S]*?<\/\1>/g, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/https?:\/\/\S+/g, ' ')
		.trim()
		.slice(0, PROMPT_CHARS);
}

/** The topic a chat's title and first prompt point at; `general` when nothing does. */
export function suggestTopic(title: string, firstPrompt = ''): string {
	const prompt = openingOf(firstPrompt);
	let best = DEFAULT_TOPIC;
	let bestScore = 0;
	for (const { id, tests } of matchers) {
		let score = 0;
		for (const test of tests) {
			if (test.test(title)) score += TITLE_WEIGHT;
			if (test.test(prompt)) score += 1;
		}
		if (score > bestScore) {
			best = id;
			bestScore = score;
		}
	}
	return best;
}
