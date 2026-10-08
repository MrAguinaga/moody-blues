import { defineConfig } from 'tsup';

import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  entry: ['src/index.ts', 'src/main.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
  define: {
    'process.env.CLI_VERSION': JSON.stringify(pkg.version),
  },
});
