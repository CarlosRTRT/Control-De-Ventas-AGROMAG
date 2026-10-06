#!/usr/bin/env bash
# Copia de seguridad (base de datos + facturas): bash backup.sh  → /opt/backups/agromag-ventas/
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a
OUT="${BACKUP_DIR:-/opt/backups/agromag-ventas}"; mkdir -p "$OUT"
FECHA=$(date +%F)
# VACUUM INTO da una copia consistente aunque el sistema esté en uso
node -e "const {DatabaseSync}=require('node:sqlite');new DatabaseSync('$DATA_DIR/ventas.db').exec(\"VACUUM INTO '$OUT/ventas-$FECHA.db'\")"
tar -czf "$OUT/facturas-$FECHA.tar.gz" -C "$DATA_DIR" facturas
find "$OUT" -type f -mtime +30 -delete   # conserva 30 días
echo "Respaldo listo en $OUT"
