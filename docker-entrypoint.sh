#!/bin/sh
set -eu

mkdir -p /app/.data
chown node:node /app/.data

exec gosu node "$@"
