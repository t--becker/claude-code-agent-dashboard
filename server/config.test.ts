import path from 'node:path';
import { defaultProjectsFolder, loadConfig } from './config';

describe('config', () => {
	it('starts the folder chooser where projects usually live, else in the home folder', () => {
		const home = '/Users/me';
		const has =
			(...names: string[]) =>
			(file: string) =>
				names.some((name) => file === path.join(home, name));
		expect(defaultProjectsFolder(home, has('projects', 'Documents'))).toBe('/Users/me/projects');
		expect(defaultProjectsFolder(home, has('Documents'))).toBe('/Users/me/Documents');
		expect(defaultProjectsFolder(home, has())).toBe(home);
	});

	it('lets the environment override the folders and stays on localhost by default', () => {
		const config = loadConfig({ REPO_ROOT: '/work', DATA_DIR: '/data' } as NodeJS.ProcessEnv);
		expect(config).toMatchObject({ repoRoot: '/work', dataDir: '/data', host: '127.0.0.1' });
	});
});
