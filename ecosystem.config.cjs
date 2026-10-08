module.exports = {
  apps: [{
    name: 'graphql-api',
    script: 'src/index.ts',
    interpreter: 'npx',
    interpreter_args: 'tsx',
    // Production mode makes JWT_SECRET required and masks error details.
    env: { NODE_ENV: 'production', PORT: '4000' },
    env_file: '.env',
    watch: false,
    max_restarts: 5,
    restart_delay: 5000,
  }]
};
