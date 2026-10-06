#!/usr/bin/env bash
# Actualiza este proyecto en la VPS: bash deploy.sh
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo "Falta .env (copie .env.example y complételo)"; exit 1; }

set -a; . ./.env; set +a   # SITE_DOMAIN se usa al compilar
git pull --ff-only
npm ci
npm run build
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
pm2 status
