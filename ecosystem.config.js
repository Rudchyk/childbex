module.exports = {
  apps: [
    {
      name: 'childbex',
      script: './server.js',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
