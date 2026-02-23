import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      'pure-crypto': 'src/pure-crypto.ts',
      registry: 'src/registry.ts',
    },
    format: ['esm'],
    target: 'node22',
    dts: true,
    clean: true,
    outDir: 'dist',
  },
  {
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    target: 'node22',
    dts: false,
    outDir: 'dist',
    banner: { js: '#!/usr/bin/env node' },
  },
]);
