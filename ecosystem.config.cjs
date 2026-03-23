module.exports = {
  apps: [
    {
      name: "room-bot",
      script: "src/index.js",
      cwd: "/opt/room-bot",
      env_file: ".env",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "256M",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
