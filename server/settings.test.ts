import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SettingsStore } from './settings';

describe('SettingsStore', () => {
	it('remembers the workspace permission mode, privately, and falls back to asking', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-settings-'));
		const file = path.join(dir, 'settings.json');
		const store = new SettingsStore(file);
		expect(store.load()).toEqual({ defaultPermissionMode: 'default' });
		store.save({ defaultPermissionMode: 'bypassPermissions' });
		expect(new SettingsStore(file).load()).toEqual({ defaultPermissionMode: 'bypassPermissions' });
		expect(fs.statSync(file).mode & 0o777).toBe(0o600);
		fs.writeFileSync(file, '{"defaultPermissionMode":"anything goes"}');
		expect(store.load()).toEqual({ defaultPermissionMode: 'default' });
		// The workspace model is kept beside it, and a damaged value is dropped.
		store.save({ defaultPermissionMode: 'auto', defaultModel: 'opus' });
		expect(new SettingsStore(file).load()).toEqual({
			defaultPermissionMode: 'auto',
			defaultModel: 'opus',
		});
		fs.writeFileSync(file, '{"defaultPermissionMode":"auto","defaultModel":42}');
		expect(store.load()).toEqual({ defaultPermissionMode: 'auto' });
		fs.rmSync(dir, { recursive: true, force: true });
	});
});
