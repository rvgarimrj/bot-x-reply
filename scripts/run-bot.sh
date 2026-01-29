#!/bin/bash
cd /Users/user/AppsCalude/Bot-X-Reply

# Carrega variáveis de ambiente
export $(cat .env | grep -v '^#' | xargs)

# Aguarda Chrome estar pronto
sleep 10

# Executa o bot
exec /usr/local/bin/node scripts/reply-bot.js
