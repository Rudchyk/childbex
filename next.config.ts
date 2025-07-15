import type { NextConfig } from 'next';
import CopyWebpackPlugin from 'copy-webpack-plugin';
import path from 'path';

const nextConfig: NextConfig = {
  // reactStrictMode: false,
  serverExternalPackages: ['sequelize'],
  experimental: {
    serverActions: {
      bodySizeLimit: '500mb',
    },
  },
  webpack(config, { isServer }) {
    // if (!isServer) {
    //   config.plugins.push(
    //     new CopyWebpackPlugin({
    //       patterns: [
    //         {
    //           from: path.resolve(process.cwd(), 'node_modules/dwv/dist/assets'),
    //           to: path.resolve(process.cwd(), 'public/assets'),
    //         },
    //       ],
    //     })
    //   );
    // }
    return config;
  },
};

export default nextConfig;
