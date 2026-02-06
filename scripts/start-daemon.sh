#!/bin/bash
# Inicia o auto-daemon com auto-restart
# Uso: nohup ./scripts/start-daemon.sh >> logs/auto-daemon.log 2>&1 &

NODE="/usr/local/bin/node"
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR"

while true; do
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Iniciando auto-daemon..."
  $NODE scripts/auto-daemon.js
  EXIT_CODE=$?

  if [ $EXIT_CODE -eq 0 ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Daemon encerrado normalmente (SIGINT). Não reiniciando."
    exit 0
  fi

  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Daemon crashou (exit code: $EXIT_CODE). Reiniciando em 30s..."
  sleep 30
done
