/// <reference types='vitest' />
import { defineConfig, PluginOption, loadEnv, normalizePath } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { viteStaticCopy } from 'vite-plugin-static-copy';

type Robots = 'allow' | 'disallow' | undefined;

function robotsTxtPlugin(isProd: boolean, robots?: Robots): PluginOption {
  console.log('ROBOTS', robots);
  console.log('isProd', isProd);

  const buildSource = (allow: boolean) =>
    // production: allow all  | development: disallow all
    `User-agent: *\nDisallow:${allow ? '' : ' /'}\n`;

  if (isProd) {
    return {
      name: 'robots-txt',
      apply: 'build',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'robots.txt',
          source: buildSource(robots === 'allow'),
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
          res.end(buildSource(robots === 'allow'));
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
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
    plugins: [
      react(),
      robotsTxtPlugin(mode === 'production', env.VITE_ROBOTS as Robots),
      viteStaticCopy({
        targets: [
          {
            src: normalizePath(
              path.resolve(__dirname, 'src/assets/manifest.json')
            ),
            dest: '.',
          },
        ],
      }),
    ],
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
