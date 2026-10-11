#!/usr/bin/env bash
# Restaura la base de datos desde la copia de Supabase. Como root:
#   bash restaurar.sh /tmp/prueba.db   → SOLO comprueba: restaura en otro archivo, sin tocar el sistema
#   bash restaurar.sh                   → RESTAURA de verdad: reemplaza la base actual (la guarda aparte) y reinicia el sistema
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Ejecute como root"; exit 1; }
DB=${DB:-/opt/data/agromag-ventas/ventas.db}
APP=${APP:-agromag-ventas}          # nombre del proyecto en pm2
[ -f /etc/litestream.env ] && { set -a; . /etc/litestream.env; set +a; } || { echo "Falta /etc/litestream.env (¿corrió litestream.sh?)"; exit 1; }

if [ $# -ge 1 ]; then
  [ ! -e "$1" ] || { echo "$1 ya existe; elija otro nombre"; exit 1; }
  litestream restore -config /etc/litestream.yml -o "$1" "$DB"
  echo "Copia restaurada en $1 (el sistema no se tocó)."
  exit 0
fi

echo "Esto REEMPLAZA la base de datos actual ($DB) por la última copia de Supabase."
read -rp "La actual se guarda aparte. ¿Continuar? (escriba si): " OK
[ "$OK" = "si" ] || { echo "Cancelado"; exit 1; }

sudo -u deploy -H pm2 stop "$APP" || true
systemctl stop litestream || true
mkdir -p "$(dirname "$DB")"
SUFIJO=antes-$(date +%F-%H%M)
for x in "" -wal -shm; do [ -f "$DB$x" ] && mv "$DB$x" "$DB$x.$SUFIJO"; done
rm -rf "$DB-litestream"   # estado interno de Litestream: se reconstruye solo

litestream restore -config /etc/litestream.yml -o "$DB" "$DB"
chown deploy:deploy "$DB"
systemctl start litestream
sudo -u deploy -H pm2 start "$APP" 2>/dev/null || sudo -u deploy -H pm2 restart "$APP"
echo "Listo. Base restaurada; la anterior quedó como $DB.$SUFIJO"
