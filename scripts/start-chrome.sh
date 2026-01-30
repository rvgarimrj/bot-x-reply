#!/bin/bash

# Abre o Chrome com porta de debug para o bot conectar
# O bot vai usar o Chrome que você já está logado no X

echo "🌐 Abrindo Chrome com porta de debug (9222)..."
echo ""
echo "IMPORTANTE: Use este Chrome para estar logado no X"
echo "O bot vai conectar nele para postar replies"
echo ""

# Mata Chrome existente se tiver (opcional)
# pkill -f "Google Chrome"

# Abre Chrome com debug port
# Flags extras para funcionar com tela bloqueada:
#   --disable-background-timer-throttling: evita throttling de timers
#   --disable-backgrounding-occluded-windows: mantém renderização ativa
#   --disable-renderer-backgrounding: evita suspensão do renderer
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --no-first-run \
  --no-default-browser-check \
  --disable-background-timer-throttling \
  --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding \
  "https://x.com" &

echo "✅ Chrome aberto!"
echo "Agora você pode usar o bot normalmente."
