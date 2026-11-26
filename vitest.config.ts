import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

const alias = { '@shared': path.resolve(import.meta.dirname, 'shared') };

export default defineConfig({
	test: {
		globals: true,
		projects: [
			{
				test: {
					name: 'server',
					environment: 'node',
					include: ['server/**/*.test.ts', 'shared/**/*.test.ts'],
				},
				resolve: { alias },
			},
			{
				plugins: [react()],
				test: {
					name: 'web',
					environment: 'jsdom',
					include: ['web/src/**/*.test.{ts,tsx}'],
					setupFiles: ['./web/src/tests/setupTests.ts'],
				},
				resolve: { alias },
			},
		],
	},
});
