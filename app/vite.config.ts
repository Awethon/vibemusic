import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

const navidrome = process.env.NAVIDROME_URL ?? 'http://127.0.0.1:4534';
const proxied = Object.fromEntries(['/auth', '/api', '/rest'].map((path) => [path, { target: navidrome, changeOrigin: true }]));

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
			},
			adapter: adapter({ fallback: 'index.html' })
		})
	],
	server: { port: 5190, strictPort: true, proxy: proxied },
	preview: { port: 5191, strictPort: true, proxy: proxied },
	optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
	worker: { format: 'es' },
	test: { include: ['src/**/*.test.ts'], environment: 'node' }
});
