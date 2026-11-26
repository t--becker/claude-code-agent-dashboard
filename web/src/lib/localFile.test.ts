import { localFileHref } from './localFile';

describe('localFileHref', () => {
	const cwd = '/Users/me/projects/shop';
	it.each([
		['relative file', '184373.html', '/api/files/Users/me/projects/shop/184373.html'],
		['sibling repo', '../other/out/x.png', '/api/files/Users/me/projects/other/out/x.png'],
		['absolute path', '/Users/me/Desktop/a.md', '/api/files/Users/me/Desktop/a.md'],
		['file url', 'file:///Users/me/a.txt', '/api/files/Users/me/a.txt'],
		[
			'line anchor kept',
			'server/app.ts#L42',
			'/api/files/Users/me/projects/shop/server/app.ts#L42',
		],
		['space encoded', 'My File.html', '/api/files/Users/me/projects/shop/My%20File.html'],
		['cwd with trailing slash', 'a.txt', '/api/files/Users/me/projects/shop/a.txt', `${cwd}/`],
		['web link untouched', 'https://example.com/x', 'https://example.com/x'],
		['mailto untouched', 'mailto:a@b.c', 'mailto:a@b.c'],
		['anchor untouched', '#top', '#top'],
	])('%s', (_name, href, expected, base = cwd) => {
		expect(localFileHref(href, base)).toBe(expected);
	});
});
