import type { ServerConfig } from './config';

/**
 * The server has no login: it trusts whoever can reach it, and it can run agents with full
 * permissions and read files under the repos folder. Binding to localhost keeps other
 * machines out, but a web page open in this machine's browser can still send requests to
 * localhost. These checks keep such pages out:
 *
 * - Host must be this server's own address, which stops DNS rebinding (an outside domain
 *   pointed at 127.0.0.1 so its pages count as same-origin).
 * - Origin, which browsers attach to every cross-site request, WebSocket handshake and POST,
 *   must be the workspace's own page.
 * - Requests the browser itself labels cross-site are refused.
 * - Anything that changes state must be sent as JSON, which a page on another site cannot
 *   do without a preflight this server never approves.
 *
 * Requests with no Origin at all (curl, scripts on this machine) are allowed: anything that
 * can run a local command can already do more than this API offers.
 */

/** Port Vite serves the web client on in development (vite.config.ts). */
export const WEB_DEV_PORT = 5173;

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

export interface RequestFacts {
	method: string;
	/** Host header, e.g. `127.0.0.1:4848`. */
	host?: string;
	origin?: string;
	/** Sec-Fetch-Site, which current browsers send on every request. */
	fetchSite?: string;
	contentType?: string;
}

export interface OriginPolicy {
	/** Returns why a request is refused, or undefined when it may proceed. */
	refuse(facts: RequestFacts): string | undefined;
}

function hostnameOf(host: string): string {
	const value = host.trim().toLowerCase();
	if (value.startsWith('[')) return value.slice(0, value.indexOf(']') + 1);
	return value.split(':')[0] ?? '';
}

export function makeOriginPolicy(
	config: Pick<ServerConfig, 'host' | 'port' | 'production'>
): OriginPolicy {
	const hostnames = new Set([...LOOPBACK_HOSTS, config.host.toLowerCase()]);
	const ports = config.production ? [config.port] : [config.port, WEB_DEV_PORT];
	const origins = new Set<string>();
	for (const name of hostnames) {
		for (const port of ports) origins.add(`http://${name}:${port}`);
	}

	return {
		refuse({ method, host, origin, fetchSite, contentType }) {
			if (!host || !hostnames.has(hostnameOf(host))) return 'Unexpected Host header';
			if (origin !== undefined && !origins.has(origin.toLowerCase()))
				return 'Requests from other sites are not allowed';
			if (fetchSite?.toLowerCase() === 'cross-site')
				return 'Requests from other sites are not allowed';
			const changesState = method !== 'GET' && method !== 'HEAD';
			if (changesState && !/^application\/json\b/i.test(contentType ?? ''))
				return 'Send the request as application/json';
			return undefined;
		},
	};
}

/** True when the configured bind address is reachable from other machines. */
export function isExposed(host: string): boolean {
	return !LOOPBACK_HOSTS.includes(host.toLowerCase()) && host !== '::1';
}
