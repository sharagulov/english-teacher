#!/usr/bin/env bash
# Однократная установка systemd-сервиса Lexio на VPS. Запуск: sudo bash scripts/install-service.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/lexio}"
SERVICE="${SERVICE_NAME:-lexio}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Запустите от root: sudo bash scripts/install-service.sh"
  exit 1
fi

if [[ ! -f "$APP_DIR/deploy/lexio.service" ]]; then
  echo "Не найден $APP_DIR/deploy/lexio.service — сначала git pull в $APP_DIR"
  exit 1
fi

if [[ ! -f "$APP_DIR/backend/.env" ]]; then
  echo "Нет $APP_DIR/backend/.env — заполните .env до установки сервиса."
  exit 1
fi

install -m 644 "$APP_DIR/deploy/lexio.service" "/etc/systemd/system/${SERVICE}.service"
cat >/etc/sudoers.d/lexio-deploy <<EOF
lexio ALL=NOPASSWD: /bin/systemctl restart ${SERVICE}, /bin/systemctl status ${SERVICE}, /bin/systemctl is-enabled ${SERVICE}, /bin/systemctl cat ${SERVICE}
EOF
chmod 440 /etc/sudoers.d/lexio-deploy

systemctl daemon-reload
systemctl enable --now "$SERVICE"
systemctl status "$SERVICE" --no-pager

echo "Сервис ${SERVICE} установлен и запущен."
