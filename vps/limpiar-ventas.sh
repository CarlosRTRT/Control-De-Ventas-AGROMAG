#!/usr/bin/env bash
# Borra las VENTAS de prueba y deja todo lo demás: animales, productos, servicios con su precio, empleados y el código del local.
# Devuelve a cada animal/producto la cantidad que esas ventas habían descontado.
# Se corre como el usuario deploy, en la carpeta del proyecto:   bash vps/limpiar-ventas.sh
# Antes de borrar guarda un respaldo y pide confirmación.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && { set -a; . ./.env; set +a; }
DATA_DIR=${DATA_DIR:-data}
APP=${APP:-agromag-ventas}                 # nombre del proyecto en pm2
RESPALDOS=${RESPALDOS:-/opt/backups/$APP}
DB="$DATA_DIR/ventas.db"
[ -f "$DB" ] || { echo "No encuentro la base de datos: $DB"; exit 1; }
export DB

contar() { node --no-warnings -e "
const { DatabaseSync } = require('node:sqlite');
const d = new DatabaseSync(process.env.DB);
const n = t => d.prepare('select count(*) n from ' + t).get().n;
const sinCerrar = d.prepare('select (select count(*) from ventas where cierre is null) + (select count(*) from servicios where cierre is null) n').get().n;
console.log('  Se borrarán  -> ventas (renglones):', n('ventas'), '| servicios vendidos:', n('servicios'), '| sin cerrar:', sinCerrar);
console.log('  Se conservan -> animales y productos:', n('animales'), '| servicios del catálogo:', n('catalogo_servicios'), '| empleados:', n('empleados'));
"; }

echo "Base de datos: $DB"
contar
echo
if [ "${CONFIRMAR:-}" != "LIMPIAR" ]; then
  read -rp "Esto borra las ventas de prueba (se hace un respaldo antes). Escriba LIMPIAR para continuar: " OK
  [ "$OK" = "LIMPIAR" ] || { echo "Cancelado. No se borró nada."; exit 1; }
fi

# Con el sistema detenido un momento, nadie vende a mitad de la limpieza. Se vuelve a encender siempre, aunque algo falle.
PM2=0
if command -v pm2 >/dev/null && pm2 describe "$APP" >/dev/null 2>&1; then PM2=1; pm2 stop "$APP" >/dev/null; fi
reiniciar() { [ "$PM2" = 1 ] && pm2 start "$APP" >/dev/null 2>&1 || true; }
trap reiniciar EXIT

mkdir -p "$RESPALDOS"
COPIA="$RESPALDOS/antes-de-limpiar-$(date +%F-%H%M).db"
export COPIA
node --no-warnings -e "
const { DatabaseSync } = require('node:sqlite');
new DatabaseSync(process.env.DB).exec(\"VACUUM INTO '\" + process.env.COPIA.replace(/'/g, \"''\") + \"'\");
"
echo "Respaldo guardado en: $COPIA"

node --no-warnings -e "
const { DatabaseSync } = require('node:sqlite');
const d = new DatabaseSync(process.env.DB);
d.exec('BEGIN');
d.exec('UPDATE animales SET cantidad = cantidad + coalesce((SELECT sum(v.cantidad) FROM ventas v WHERE v.animal_id = animales.id), 0)');
d.exec('DELETE FROM ventas');
d.exec('DELETE FROM servicios');
d.exec('COMMIT');
"
echo
echo "Listo. Estado después de limpiar:"
node --no-warnings -e "
const { DatabaseSync } = require('node:sqlite');
const d = new DatabaseSync(process.env.DB);
const n = t => d.prepare('select count(*) n from ' + t).get().n;
console.log('  ventas:', n('ventas'), '| servicios vendidos:', n('servicios'));
for (const a of d.prepare('select tipo, clase, cantidad from animales where activo = 1 order by clase, tipo').all()) console.log('  inventario ->', a.tipo + ' (' + a.clase + '):', a.cantidad);
"
echo
echo "Ahora entre al panel y ponga las cantidades REALES de su inventario."
