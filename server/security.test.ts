import { createApp } from './app';
import { loadConfig } from './config';
import { isExposed, makeOriginPolicy } from './security';
import { makeManager, makeSession } from './test_helpers';

const policy = makeOriginPolicy({ host: '127.0.0.1', port: 4848, production: true });
const json = { contentType: 'application/json' };

describe('origin policy', () => {
	it('lets the workspace page and local scripts through', () => {
		expect(policy.refuse({ method: 'GET', host: '127.0.0.1:4848' })).toBeUndefined();
		expect(
			policy.refuse({
				method: 'POST',
				host: 'localhost:4848',
				origin: 'http://localhost:4848',
				fetchSite: 'same-origin',
				...json,
			})
		).toBeUndefined();
		expect(policy.refuse({ method: 'POST', host: '127.0.0.1:4848', ...json })).toBeUndefined();
	});

	it('refuses a page on another site, however it sends the request', () => {
		const host = '127.0.0.1:4848';
		expect(policy.refuse({ method: 'GET', host, origin: 'https://evil.example' })).toBeDefined();
		expect(policy.refuse({ method: 'GET', host, origin: 'null' })).toBeDefined();
		expect(policy.refuse({ method: 'GET', host, fetchSite: 'cross-site' })).toBeDefined();
		// Another app on this machine is a different origin too.
		expect(policy.refuse({ method: 'GET', host, origin: 'http://localhost:3000' })).toBeDefined();
		// A form or no-cors post cannot declare JSON, so it is refused even with no Origin.
		expect(policy.refuse({ method: 'POST', host, contentType: 'text/plain' })).toBeDefined();
		expect(policy.refuse({ method: 'DELETE', host })).toBeDefined();
	});

	it('refuses a rebound domain that points at this machine', () => {
		expect(policy.refuse({ method: 'GET', host: 'rebind.evil.example:4848' })).toBeDefined();
		expect(policy.refuse({ method: 'GET', host: undefined })).toBeDefined();
	});

	it('accepts the Vite page only in development', () => {
		const dev = makeOriginPolicy({ host: '127.0.0.1', port: 4848, production: false });
		const facts = { method: 'GET', host: 'localhost:5173', origin: 'http://localhost:5173' };
		expect(dev.refuse(facts)).toBeUndefined();
		expect(policy.refuse(facts)).toBeDefined();
	});

	it('knows when the bind address is reachable from other machines', () => {
		expect(isExposed('127.0.0.1')).toBe(false);
		expect(isExposed('localhost')).toBe(false);
		expect(isExposed('0.0.0.0')).toBe(true);
	});
});

describe('API guard', () => {
	const create = JSON.stringify({
		title: 'x',
		project: 'x',
		path: '/tmp',
		provider: 'claude-code',
		model: 'claude-sonnet-5-5',
		permissionMode: 'bypassPermissions',
		prompt: 'run something',
	});

	async function app() {
		const { manager, info } = await makeManager({ initial: [makeSession()] });
		const config = loadConfig({ NODE_ENV: 'production' } as NodeJS.ProcessEnv);
		return { app: createApp({ config, manager, providerInfos: () => [info] }), manager };
	}

	it('stops another site from starting an agent or reading the chats', async () => {
		const { app: server, manager } = await app();
		const before = manager.list().length;
		const noCors = await server.request('/api/sessions', {
			method: 'POST',
			headers: { 'content-type': 'text/plain', origin: 'https://evil.example' },
			body: create,
		});
		expect(noCors.status).toBe(403);
		const spoofedType = await server.request('/api/sessions', {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
			body: create,
		});
		expect(spoofedType.status).toBe(403);
		const read = await server.request('/api/bootstrap', {
			headers: { origin: 'https://evil.example' },
		});
		expect(read.status).toBe(403);
		const rebound = await server.request('/api/bootstrap', {
			headers: { host: 'rebind.evil.example:4848' },
		});
		expect(rebound.status).toBe(403);
		expect(manager.list()).toHaveLength(before);
	});

	it('still serves the workspace page itself', async () => {
		const { app: server } = await app();
		const read = await server.request('/api/bootstrap', {
			headers: { host: '127.0.0.1:4848', origin: 'http://127.0.0.1:4848' },
		});
		expect(read.status).toBe(200);
	});
});
