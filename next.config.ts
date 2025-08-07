import type { NextConfig } from 'next';
import path from 'path';
import CopyPlugin from 'copy-webpack-plugin';

const isNotIndexing = process.env.INDEXING === 'false';
console.log('isNotIndexing', isNotIndexing);

const nextConfig: NextConfig = {
  serverExternalPackages: ['sequelize'],
  experimental: {
    serverActions: {
      bodySizeLimit: '500mb',
    },
  },
  async headers() {
    const headers = [];

    if (isNotIndexing) {
      headers.push({
        source: '/:path*',
        headers: [
          {
            key: 'X-Robots-Tag',
            value: 'noindex, nofollow',
          },
        ],
      });
    }
    return headers;
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      const robotsFileName = 'robots.txt';
      const dest = path.resolve(__dirname, 'public', robotsFileName);
      config.plugins.push(
        new CopyPlugin({
          patterns: [
            {
              from: path.resolve(__dirname, 'assets', robotsFileName),
              to: dest,
              transform: (data) => {
                if (isNotIndexing) {
                  return `User-agent: *\nDisallow: /`;
                }
                return data;
              },
            },
          ],
        })
      );
    } else {
      config.resolve.fallback = { fs: false, net: false, tls: false };
      config.externals.push('pino-pretty', 'encoding');
    }
    return config;
  },
};

export default nextConfig;
