#!/usr/bin/env bash
# Dừng đột ngột 1 replica của ticket-service để kiểm tra failover
set -euo pipefail
CID=$(docker compose ps -q ticket-service | head -n 1)
echo "Dừng container: $(docker inspect -f '{{.Name}}' "$CID")"
docker stop "$CID"
