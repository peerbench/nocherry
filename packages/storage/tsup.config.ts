import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    sqlite: 'src/sqlite.ts',
    postgres: 'src/postgres.ts',
    types: 'src/types.ts',
  },
  format: ['esm'],
  target: 'node22',
  dts: true,
  clean: true,
  outDir: 'dist',
  splitting: false,
});
