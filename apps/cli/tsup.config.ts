import { defineConfig } from 'tsup';

import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  clean: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
  define: {
    'process.env.CLI_VERSION': JSON.stringify(pkg.version),
  },
});
