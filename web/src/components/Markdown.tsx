import { useMemo } from 'react';
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FILE_ROUTE } from '@shared/types';
import { localFileHref } from '../lib/localFile';

// file: links would otherwise be blanked before the components below ever see them.
const urlTransform = (url: string) => (url.startsWith('file:') ? url : defaultUrlTransform(url));

function makeComponents(cwd?: string): Components {
	const resolve = (url: string) => (cwd ? localFileHref(url, cwd) : url);
	return {
		// Links leave the workspace, so they open beside it rather than replacing it.
		a: ({ node: _node, href, ...props }) => (
			<a {...props} href={href && resolve(href)} target="_blank" rel="noreferrer" />
		),
		// Only pictures on this machine are shown. A picture on another site loads the moment the
		// reply renders, so a reply steered by something the agent read could leak text in its URL.
		img: ({ node: _node, src, alt, ...props }) => {
			const resolved = typeof src === 'string' ? resolve(src) : undefined;
			if (resolved?.startsWith(`${FILE_ROUTE}/`))
				return <img {...props} alt={alt} src={resolved} />;
			return typeof src === 'string' ? (
				<a href={src} target="_blank" rel="noreferrer">
					{alt || 'image'} (picture on another site, not loaded)
				</a>
			) : null;
		},
	};
}

interface Props {
	text: string;
	className?: string;
	/** Folder that file links in the text are relative to. Without it they are left as written. */
	cwd?: string;
}

/** Renders an agent reply as GitHub-flavoured Markdown. Raw HTML in the text is never rendered. */
export function Markdown({ text, className, cwd }: Props) {
	const components = useMemo(() => makeComponents(cwd), [cwd]);
	return (
		<div className={`md${className ? ` ${className}` : ''}`}>
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				components={components}
				urlTransform={urlTransform}
			>
				{text}
			</ReactMarkdown>
		</div>
	);
}
