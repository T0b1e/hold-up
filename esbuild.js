const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

esbuild
  .context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external: ['vscode'],
    outfile: 'dist/extension.js',
    sourcemap: true,
    logLevel: 'info',
  })
  .then(async (ctx) => {
    if (watch) return ctx.watch();
    await ctx.rebuild();
    await ctx.dispose();
  })
  .catch(() => process.exit(1));
