import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { app: 'src/app.ts', server: 'src/server.ts' },
  format: ['esm'],
  target: 'node22',
  dts: false,
  clean: true,
  outDir: 'dist',
});
