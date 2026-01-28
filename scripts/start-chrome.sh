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
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --no-first-run \
  --no-default-browser-check \
  "https://x.com" &

echo "✅ Chrome aberto!"
echo "Agora você pode usar o bot normalmente."
