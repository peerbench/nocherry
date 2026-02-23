import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { app: 'src/app.ts', server: 'src/server.ts', signing: 'src/signing.ts' },
  format: ['esm'],
  target: 'node22',
  dts: true,
  clean: true,
  outDir: 'dist',
});
