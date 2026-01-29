#!/bin/bash
cd /Users/user/AppsCalude/Bot-X-Reply

# Carrega variáveis de ambiente
export $(cat .env | grep -v '^#' | xargs)

# Aguarda Chrome e bot estarem prontos
sleep 20

# Executa o daemon
exec /usr/local/bin/node scripts/search-daemon.js
