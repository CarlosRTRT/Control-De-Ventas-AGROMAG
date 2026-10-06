#!/usr/bin/env bash
# Preparación de una VPS limpia (Ubuntu/Debian). Se corre UNA sola vez, como root:  bash setup.sh
# Deja: Node 24, pm2, nginx, certbot, firewall, y un usuario "deploy" que será dueño de todos los proyectos.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Ejecute como root"; exit 1; }

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y nginx certbot python3-certbot-nginx ufw git curl ca-certificates

# Node 24 (node:sqlite viene incluido, sin compilar nada)
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs
npm install -g pm2

# Usuario sin contraseña que reutiliza las llaves SSH de root
id deploy >/dev/null 2>&1 || adduser --disabled-password --gecos "" deploy
if [ -f /root/.ssh/authorized_keys ]; then
  install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
  install -m 600 -o deploy -g deploy /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
fi

# Carpetas: una por proyecto en /opt/apps (código) y /opt/data (base de datos y archivos subidos)
mkdir -p /opt/apps /opt/data /opt/backups
chown deploy:deploy /opt/apps /opt/data /opt/backups

# pm2 arranca solo al reiniciar la VPS, y los logs no crecen sin límite
env PATH="$PATH:/usr/bin" pm2 startup systemd -u deploy --hp /home/deploy
sudo -u deploy pm2 install pm2-logrotate

# Firewall: solo SSH, HTTP y HTTPS
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

rm -f /etc/nginx/sites-enabled/default
systemctl enable --now nginx
echo "Listo. Ahora entre como: ssh deploy@$(hostname -I | awk '{print $1}')"
