#!/usr/bin/env bash
# Publica un proyecto con HTTPS. Se corre una vez por proyecto, como root:
#   bash nuevo-sitio.sh agromag.duckdns.org 4321 correo@ejemplo.com
# (dominio, puerto interno donde escucha el proyecto con pm2, correo para avisos del certificado)
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Ejecute como root"; exit 1; }
[ $# -eq 3 ] || { echo "Uso: bash nuevo-sitio.sh dominio puerto correo"; exit 1; }
DOMINIO=$1; PUERTO=$2; CORREO=$3

cat > "/etc/nginx/sites-available/$DOMINIO" <<EOF
server {
  listen 80;
  server_name $DOMINIO;
  client_max_body_size 16m;   # facturas de hasta 15 MB

  location / {
    proxy_pass http://127.0.0.1:$PUERTO;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header X-Forwarded-Host \$host;
  }
}
EOF
ln -sf "/etc/nginx/sites-available/$DOMINIO" "/etc/nginx/sites-enabled/$DOMINIO"
nginx -t && systemctl reload nginx
certbot --nginx -d "$DOMINIO" -m "$CORREO" --agree-tos --non-interactive --redirect
echo "Listo: https://$DOMINIO"
