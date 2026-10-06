// pm2 de este proyecto. Los secretos y el puerto viven en .env (no se sube al repo): ver .env.example
module.exports = {
  apps: [{
    name: 'agromag-ventas',
    script: 'dist/server/entry.mjs',
    node_args: '--env-file=.env', // ADMIN_PIN, PORT, HOST, DATA_DIR, COOKIE_SECURE
    exec_mode: 'fork',            // una sola instancia: SQLite y las sesiones viven en un solo proceso
    max_memory_restart: '300M',
    time: true,                   // fecha en cada línea del log
  }],
};
