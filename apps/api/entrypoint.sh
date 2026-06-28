#!/bin/sh
set -e
echo "Aplicando migrations..."
node ./node_modules/prisma/build/index.js migrate deploy
exec "$@"
