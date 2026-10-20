module.exports = {
  apps: [{
    name: 'graphql-api',
    cwd: __dirname,
    script: 'src/index.ts',
    interpreter: 'node',
    // tsx is a production dependency and runs as a Node loader; Node itself
    // loads .env (PM2 has no env_file option).
    interpreter_args: '--import tsx --env-file=.env',
    // Production mode makes BETTER_AUTH_SECRET and the Google client required, and masks error details.
    env: { NODE_ENV: 'production', PORT: '4000' },
    watch: false,
    max_restarts: 5,
    restart_delay: 5000,
  }]
};
