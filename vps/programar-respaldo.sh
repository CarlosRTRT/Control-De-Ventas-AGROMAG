#!/usr/bin/env bash
# Hace que el respaldo diario (backup.sh) corra SOLO cada noche. Se corre una vez, como el usuario deploy (no root):
#   bash programar-respaldo.sh                    → todos los días a las 2:00 a. m.
#   HORA=3 bash programar-respaldo.sh             → a las 3:00 a. m.
#   APP_DIR=/opt/apps/otro bash programar-respaldo.sh   → para otro proyecto
# Es seguro correrlo varias veces: reemplaza la línea anterior, no la duplica.
set -euo pipefail
[ "$(id -u)" != 0 ] || { echo "Ejecútelo como el usuario deploy (su deploy), no como root"; exit 1; }

APP_DIR=${APP_DIR:-/opt/apps/agromag-ventas}
HORA=${HORA:-2}
RESPALDOS=${RESPALDOS:-/opt/backups}   # donde se guardan los respaldos y el registro
[[ "$HORA" =~ ^([0-9]|1[0-9]|2[0-3])$ ]] || { echo "HORA debe ser un número de 0 a 23"; exit 1; }
[ -f "$APP_DIR/backup.sh" ] || { echo "No encuentro $APP_DIR/backup.sh"; exit 1; }
[ -f "$APP_DIR/.env" ] || { echo "Falta $APP_DIR/.env (backup.sh lo necesita)"; exit 1; }
command -v crontab >/dev/null || { echo "No está instalado cron. Como root: apt-get install -y cron"; exit 1; }

MARCA="# respaldo-diario $APP_DIR"
LINEA="0 $HORA * * * cd $APP_DIR && bash backup.sh >> $RESPALDOS/$(basename "$APP_DIR").log 2>&1 $MARCA"
mkdir -p "$RESPALDOS"

# Se conservan las demás tareas del usuario; solo se cambia la de este respaldo
( crontab -l 2>/dev/null | grep -vF "$MARCA" || true; echo "$LINEA" ) | crontab -

echo "Listo: el respaldo de $APP_DIR correrá todos los días a las $HORA:00."
echo "Tarea programada:"; crontab -l | grep -F "$MARCA"
echo
echo "Pruébelo ahora mismo (no hace falta esperar a la noche):  cd $APP_DIR && bash backup.sh"
