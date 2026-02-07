module.exports = {
  apps: [
    {
      name: 'morph-backend',
      script: 'dist/main.js',
      instances: 1, // Keep at 1 for WebSocket state consistency
      exec_mode: 'fork', // Use 'fork' mode for WebSockets (not 'cluster')
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development',
        PORT: 3005,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      // Graceful shutdown
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,
      // Logging
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      log_file: './logs/combined.log',
      time: true,
      // Restart on crash
      exp_backoff_restart_delay: 100,
    },
  ],
};
