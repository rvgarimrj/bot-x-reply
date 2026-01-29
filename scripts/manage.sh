#!/bin/bash
# Gerenciador do Bot-X-Reply

case "$1" in
  start)
    echo "Iniciando serviços..."
    launchctl load ~/Library/LaunchAgents/com.botxreply.chrome.plist 2>/dev/null
    launchctl load ~/Library/LaunchAgents/com.botxreply.bot.plist 2>/dev/null
    launchctl load ~/Library/LaunchAgents/com.botxreply.daemon.plist 2>/dev/null
    echo "Serviços iniciados!"
    ;;
  stop)
    echo "Parando serviços..."
    launchctl unload ~/Library/LaunchAgents/com.botxreply.bot.plist 2>/dev/null
    launchctl unload ~/Library/LaunchAgents/com.botxreply.daemon.plist 2>/dev/null
    launchctl unload ~/Library/LaunchAgents/com.botxreply.chrome.plist 2>/dev/null
    pkill -f "node.*reply-bot.js" 2>/dev/null
    pkill -f "node.*search-daemon.js" 2>/dev/null
    echo "Serviços parados!"
    ;;
  restart)
    $0 stop
    sleep 2
    $0 start
    ;;
  status)
    echo "=== Status dos Serviços ==="
    echo ""
    echo "LaunchAgents:"
    launchctl list | grep botxreply || echo "Nenhum agent carregado"
    echo ""
    echo "Processos:"
    pgrep -fl "reply-bot.js" || echo "Bot: não rodando"
    pgrep -fl "search-daemon.js" || echo "Daemon: não rodando"
    echo ""
    echo "Chrome (porta 9222):"
    curl -s http://127.0.0.1:9222/json/version > /dev/null && echo "Chrome: conectado" || echo "Chrome: não disponível"
    ;;
  logs)
    echo "=== Logs Recentes ==="
    echo ""
    echo "--- Bot ---"
    tail -20 ~/AppsCalude/Bot-X-Reply/logs/bot.log 2>/dev/null || echo "Sem logs"
    echo ""
    echo "--- Daemon ---"
    tail -20 ~/AppsCalude/Bot-X-Reply/logs/daemon.log 2>/dev/null || echo "Sem logs"
    ;;
  *)
    echo "Uso: $0 {start|stop|restart|status|logs}"
    exit 1
    ;;
esac
