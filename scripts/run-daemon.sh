#!/bin/bash
cd /Users/user/AppsCalude/Bot-X-Reply

# Carrega variáveis de ambiente
export $(cat .env | grep -v '^#' | xargs)

# Aguarda Chrome estar pronto
sleep 30

# Executa o auto-daemon (sistema autonomo 50+ replies/dia)
exec /usr/local/bin/node scripts/auto-daemon.js
