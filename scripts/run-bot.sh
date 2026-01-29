#!/bin/bash
cd /Users/user/AppsCalude/Bot-X-Reply

# Carrega variáveis de ambiente
export $(cat .env | grep -v '^#' | xargs)

# Aguarda Chrome estar pronto
sleep 10

# Executa o bot com limite de memória (512MB)
exec /usr/local/bin/node --max-old-space-size=512 scripts/reply-bot.js
