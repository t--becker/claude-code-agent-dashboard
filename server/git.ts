import { execFile } from 'node:child_process';

export function getBranch(cwd: string): Promise<string> {
	return new Promise((resolve) => {
		execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeout: 3000 }, (err, out) => {
			if (err) return resolve('no git');
			resolve(out.trim() || 'no git');
		});
	});
}
