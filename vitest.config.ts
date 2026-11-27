import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

const alias = { '@shared': path.resolve(import.meta.dirname, 'shared') };

// React only offers its test helpers outside a production build, so the tests say which they
// want instead of trusting whatever NODE_ENV the shell happens to carry.
process.env.NODE_ENV = 'test';

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
