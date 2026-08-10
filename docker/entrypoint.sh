#!/bin/sh
set -e

case "$1" in
  server)
    exec node apps/api/dist/server.mjs
    ;;
  worker)
    exec node apps/api/dist/worker.mjs
    ;;
  migrate)
    exec node apps/api/dist/migrate.mjs
    ;;
  *)
    echo "Unknown command '$1' (expected: server | worker | migrate)" >&2
    exit 1
    ;;
esac
