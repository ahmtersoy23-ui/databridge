module.exports = {
  apps: [{
    name: 'databridge-backend',
    script: 'backend/dist/index.js',
    instances: 1,
    env: {
      NODE_ENV: 'production',
      PORT: 3008,
    },
  }],
};
