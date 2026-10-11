#!/usr/bin/env bash
# Copia CONTINUA de la base de datos a Supabase Storage (compatible con S3), con Litestream.
# Se corre UNA vez por proyecto, como root, después de que el sistema ya arrancó:   bash litestream.sh
# (otro proyecto: DB=/opt/data/otro/ventas.db NOMBRE=otro bash litestream.sh)
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Ejecute como root"; exit 1; }

VERSION=0.5.17
DB=${DB:-/opt/data/agromag-ventas/ventas.db}
NOMBRE=${NOMBRE:-agromag-ventas}   # carpeta dentro del bucket
[ -f "$DB" ] || { echo "No encuentro la base de datos: $DB. ¿Ya arrancó el sistema con pm2?"; exit 1; }

case "$(dpkg --print-architecture)" in
  amd64) ARQ=x86_64 ;;
  arm64) ARQ=arm64 ;;
  *) echo "Arquitectura no soportada"; exit 1 ;;
esac

echo "Datos de Supabase (en su panel: Storage → S3 Access Keys / S3 connection):"
read -rp "Referencia del proyecto (lo que va antes de .supabase.co): " REF
read -rp "Región del proyecto (por ejemplo us-east-1): " REGION
read -rp "Nombre del bucket (créelo privado, por ejemplo agromag-respaldos): " BUCKET
read -rp "Access key ID: " CLAVE
read -rsp "Secret access key (no se ve al escribir): " SECRETO; echo
[ -n "$REF" ] && [ -n "$REGION" ] && [ -n "$BUCKET" ] && [ -n "$CLAVE" ] && [ -n "$SECRETO" ] || { echo "Faltan datos"; exit 1; }

# Instalar Litestream (si no está), verificando la firma de la descarga
if ! command -v litestream >/dev/null || [ "$(litestream version 2>/dev/null)" != "$VERSION" ]; then
  tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT; cd "$tmp"
  base=https://github.com/benbjohnson/litestream/releases/download/v$VERSION
  deb=litestream-$VERSION-linux-$ARQ.deb
  curl -fsSLO "$base/$deb"; curl -fsSLO "$base/checksums.txt"
  grep " $deb\$" checksums.txt | sha256sum -c -
  dpkg -i "$deb"
fi

# Credenciales aparte, solo legibles por root
umask 077
cat > /etc/litestream.env <<EOF
LITESTREAM_ACCESS_KEY_ID=$CLAVE
LITESTREAM_SECRET_ACCESS_KEY=$SECRETO
EOF
umask 022

# Configuración: si ya hay otras bases configuradas, se agrega esta sin borrar las demás
URL="s3://$BUCKET/$NOMBRE?endpoint=https://$REF.supabase.co/storage/v1/s3&region=$REGION"
if [ ! -f /etc/litestream.yml ] || ! grep -q '^dbs:' /etc/litestream.yml; then echo "dbs:" > /etc/litestream.yml; fi
if grep -q "path: $DB\$" /etc/litestream.yml; then
  echo "Ya había una entrada para $DB en /etc/litestream.yml; no se duplica."
else
  cat >> /etc/litestream.yml <<EOF
  - path: $DB
    replica:
      url: $URL
EOF
fi

# El servicio lee las credenciales del archivo
mkdir -p /etc/systemd/system/litestream.service.d
printf '[Service]\nEnvironmentFile=/etc/litestream.env\n' > /etc/systemd/system/litestream.service.d/credenciales.conf
systemctl daemon-reload
systemctl enable litestream >/dev/null 2>&1
systemctl restart litestream

sleep 6
if systemctl is-active --quiet litestream; then
  echo "Listo: Litestream está copiando $DB a Supabase."
  echo "Compruébelo con:  journalctl -u litestream -n 20 --no-pager"
else
  echo "Litestream no arrancó. Revise:  journalctl -u litestream -n 30 --no-pager"; exit 1
fi
