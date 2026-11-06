#!/usr/bin/env bash
# Dùng: ./scripts/scale.sh 3   -> scale ticket-service lên N bản sao và nạp lại gateway
set -euo pipefail
N="${1:-3}"
docker compose up -d --build --scale ticket-service="$N"
# Nginx chỉ phân giải DNS khi nạp cấu hình -> reload để nhận danh sách IP mới
docker compose exec gateway nginx -s reload
docker compose ps ticket-service
