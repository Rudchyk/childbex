/// <reference types='vitest' />
import { defineConfig, PluginOption, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

function robotsTxtPlugin(allowCrawl: boolean): PluginOption {
  console.log('allowCrawl', allowCrawl);

  const buildSource = (allow: boolean) =>
    // production: allow all  | development: disallow all
    `User-agent: *\nDisallow:${allow ? '' : ' /'}\n`;

  if (allowCrawl) {
    return {
      name: 'robots-txt',
      apply: 'build',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'robots.txt',
          source: buildSource(allowCrawl),
        });
      },
    };
  }
  return {
    name: 'robots-txt',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/robots.txt') {
          res.setHeader('Content-Type', 'text/plain');
          res.end(buildSource(allowCrawl));
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const allowCrawl = env.VITE_ROBOTS
    ? env.VITE_ROBOTS === 'allow'
    : mode === 'production';
  return {
    root: __dirname,
    cacheDir: '../../node_modules/.vite/apps/gui',
    server: {
      port: 4201,
      host: 'localhost',
      proxy: {
        '/api': `http://localhost:${process.env.PORT}`,
      },
    },
    preview: {
      port: 4202,
      host: 'localhost',
    },
    plugins: [react(), robotsTxtPlugin(allowCrawl)],
    // Uncomment this if you are using workers.
    // worker: {
    //  plugins: [ nxViteTsPaths() ],
    // },
    build: {
      outDir: '../../dist/apps/gui',
      emptyOutDir: true,
      reportCompressedSize: true,
      commonjsOptions: {
        transformMixedEsModules: true,
      },
    },
  };
});
