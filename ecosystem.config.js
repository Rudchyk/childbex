module.exports = {
  apps: [
    {
      name: 'childbex',
      script: 'npm',
      args: 'start',
      env: {
        NODE_ENV: 'production',
        PORT: 3002,
      },
    },
  ],
};
