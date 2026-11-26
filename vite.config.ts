import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

const serverPort = Number(process.env.PORT ?? 4848);

export default defineConfig({
	root: 'web',
	plugins: [react()],
	resolve: {
		alias: { '@shared': path.resolve(import.meta.dirname, 'shared') },
	},
	server: {
		port: 5173,
		proxy: {
			'/api': `http://127.0.0.1:${serverPort}`,
			'/ws': { target: `ws://127.0.0.1:${serverPort}`, ws: true },
		},
	},
	build: {
		outDir: path.resolve(import.meta.dirname, 'dist/web'),
		emptyOutDir: true,
	},
});
