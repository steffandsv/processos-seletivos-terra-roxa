#!/bin/sh
# Aplica migrations (idempotente) e sobe o app. Migrations versionadas e
# reprodutíveis no deploy (§3.2).
set -e

echo "[entrypoint] aplicando migrations..."
npx prisma migrate deploy

echo "[entrypoint] iniciando aplicação..."
exec node src/server.js
