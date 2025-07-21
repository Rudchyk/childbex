import type { NextConfig } from 'next';

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
