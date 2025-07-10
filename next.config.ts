import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['sequelize'],
  transpilePackages: ['cyrillic-doctor'],
};

export default nextConfig;
