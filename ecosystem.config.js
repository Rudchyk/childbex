module.exports = {
  apps: [
    {
      name: 'childbex.com',
      script: './dist/server.js',
      env: {
        PORT: 3000,
        NODE_ENV: 'production',
      },
    },
    {
      name: 'dev.childbex.com',
      script: './dist/server.js',
      env: {
        PORT: 3001,
        NODE_ENV: 'production',
        PRETTY_LOGS: true,
      },
    },
  ],
};
