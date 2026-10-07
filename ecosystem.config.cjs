module.exports = {
  apps: [{
    name: 'graphql-api',
    script: 'src/index.ts',
    interpreter: 'npx',
    interpreter_args: 'tsx',
    env: { NODE_ENV: 'development', PORT: '4000' },
    env_file: '.env',
    watch: false,
    max_restarts: 5,
    restart_delay: 5000,
  }]
};
