#!/usr/bin/env bash
# Деплой на VPS: обновляет код с release-server, собирает и перезапускает сервис.
# Запускается из GitHub Actions по SSH. Секреты (.env, SQLite) не трогает.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/lexio}"
BRANCH="${DEPLOY_BRANCH:-release-server}"
SERVICE="${SERVICE_NAME:-lexio}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:4000/api/health}"

cd "$APP_DIR"

if [[ ! -f backend/.env ]]; then
  echo "Нет backend/.env — скопируйте .env.example и заполните JWT_SECRET до первого деплоя."
  exit 1
fi

if [[ -f backend/prisma/dev.db ]]; then
  mkdir -p backend/prisma/backups
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  cp -a backend/prisma/dev.db "backend/prisma/backups/dev.db.${stamp}"
  # Храним последние 10 копий, чтобы диск не забивался.
  find backend/prisma/backups -name 'dev.db.*' -type f | sort -r | tail -n +11 | xargs -r rm -f
fi

git fetch --prune origin
git checkout "$BRANCH"
git reset --hard "origin/${BRANCH}"

# npm ci иногда падает с ENOTEMPTY на полустёртом node_modules (lucide-react и др.).
rm -rf node_modules frontend/node_modules backend/node_modules
npm ci
npm run db:generate --workspace backend
npm run db:push --workspace backend
npm run build

if command -v systemctl >/dev/null 2>&1; then
  if ! sudo systemctl cat "$SERVICE" >/dev/null 2>&1; then
    echo "Сервис ${SERVICE} ещё не установлен."
    echo "На VPS один раз от root: sudo bash ${APP_DIR}/scripts/install-service.sh"
    echo "Или полная настройка: sudo bash ${APP_DIR}/scripts/server-setup.sh"
    exit 1
  fi
  sudo systemctl restart "$SERVICE"
fi

ok=0
for _ in $(seq 1 30); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 2
done

if [[ "$ok" -ne 1 ]]; then
  echo "Сервис не ответил на ${HEALTH_URL} за минуту."
  sudo systemctl status "$SERVICE" --no-pager || true
  exit 1
fi

echo "Деплой готов: $(git rev-parse --short HEAD) на ${BRANCH}"
