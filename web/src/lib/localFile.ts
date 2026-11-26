import { FILE_ROUTE } from '@shared/types';

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Points a Markdown link at the workspace's file route when it names a file on this machine.
 * Relative paths resolve against cwd; web links and in-page anchors come back unchanged.
 */
export function localFileHref(href: string, cwd: string): string {
	if (href.startsWith('#')) return href;
	const scheme = SCHEME.exec(href)?.[0].toLowerCase();
	if (scheme && scheme !== 'file:') return href;
	try {
		const url = new URL(href, `file://${cwd.endsWith('/') ? cwd : `${cwd}/`}`);
		return `${FILE_ROUTE}${url.pathname}${url.hash}`;
	} catch {
		return href;
	}
}
