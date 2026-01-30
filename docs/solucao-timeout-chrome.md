# Solução: Timeout do Chrome/Puppeteer com Tela Bloqueada

## Problema

Quando a tela do Mac está bloqueada, o Chrome entra em modo de suspensão e o Puppeteer não consegue se comunicar, causando erros como:

```
Network.enable timed out. Increase the 'protocolTimeout' setting
Runtime.callFunctionOn timed out
```

## Causa

1. **App Nap do macOS** - Suspende apps que não estão visíveis
2. **Chrome Background Throttling** - Reduz recursos para abas em background
3. **Timeout curto** - Puppeteer desiste rápido demais

## Solução Completa

### 1. Desativar App Nap para o Chrome

```bash
defaults write com.google.Chrome NSAppSleepDisabled -bool YES
```

Para verificar:
```bash
defaults read com.google.Chrome NSAppSleepDisabled
# Deve retornar: 1
```

### 2. Flags Anti-Suspensão no Chrome

Ao iniciar o Chrome, adicionar estas flags:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.chrome-bot-profile" \
  --no-first-run \
  --disable-background-timer-throttling \
  --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding
```

| Flag | O que faz |
|------|-----------|
| `--disable-background-timer-throttling` | Evita throttling de timers em background |
| `--disable-backgrounding-occluded-windows` | Mantém renderização ativa mesmo ocluído |
| `--disable-renderer-backgrounding` | Evita suspensão do renderer |

### 3. Aumentar Timeouts no Puppeteer

```javascript
// Conexão com Chrome
const browser = await puppeteer.connect({
  browserURL: 'http://127.0.0.1:9222',
  protocolTimeout: 120000 // 120 segundos (padrão é 30s)
})

// Operações na página
page.setDefaultTimeout(60000) // 60 segundos
page.setDefaultNavigationTimeout(60000)
```

### 4. Retry Automático na Conexão

```javascript
async function getBrowser() {
  const maxRetries = 3
  const retryDelay = 5000

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const browser = await puppeteer.connect({
        browserURL: 'http://127.0.0.1:9222',
        protocolTimeout: 120000
      })
      return browser
    } catch (error) {
      const isTimeout = error.message.includes('timed out')

      if (isTimeout && attempt < maxRetries) {
        console.log(`Tentativa ${attempt}/${maxRetries} falhou, aguardando...`)
        await new Promise(r => setTimeout(r, retryDelay))
        continue
      }
      throw error
    }
  }
}
```

### 5. Limpeza de Abas em Excesso

Abas acumuladas consomem memória e deixam o Chrome lento:

```javascript
async function closeExcessTabs(browser, maxTabs = 3) {
  try {
    const pages = await Promise.race([
      browser.pages(),
      new Promise((_, reject) => setTimeout(() => reject(), 8000))
    ]).catch(() => [])

    if (pages.length > maxTabs) {
      console.log(`Fechando ${pages.length - maxTabs} abas em excesso...`)
      for (let i = 0; i < pages.length - maxTabs; i++) {
        await pages[i].close().catch(() => {})
      }
    }
  } catch (e) {
    // Ignora erros - limpeza não é crítica
  }
}
```

### 6. LaunchAgent para Auto-Start (macOS)

Criar arquivo `~/Library/LaunchAgents/com.projeto.chrome.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.projeto.chrome</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Applications/Google Chrome.app/Contents/MacOS/Google Chrome</string>
        <string>--remote-debugging-port=9222</string>
        <string>--user-data-dir=/Users/SEU_USER/.chrome-bot-profile</string>
        <string>--no-first-run</string>
        <string>--disable-background-timer-throttling</string>
        <string>--disable-backgrounding-occluded-windows</string>
        <string>--disable-renderer-backgrounding</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
```

Carregar:
```bash
launchctl load ~/Library/LaunchAgents/com.projeto.chrome.plist
```

### 7. LaunchAgent para App Nap (executar no boot)

Criar arquivo `~/Library/LaunchAgents/com.projeto.setup.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.projeto.setup</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>-c</string>
        <string>defaults write com.google.Chrome NSAppSleepDisabled -bool YES</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
```

## Checklist de Implementação

- [ ] Desativar App Nap: `defaults write com.google.Chrome NSAppSleepDisabled -bool YES`
- [ ] Adicionar flags anti-suspensão no comando do Chrome
- [ ] Aumentar `protocolTimeout` para 120000ms
- [ ] Adicionar `page.setDefaultTimeout(60000)`
- [ ] Implementar retry automático na conexão
- [ ] Implementar limpeza de abas em excesso
- [ ] Criar LaunchAgent para Chrome (se usar auto-start)
- [ ] Criar LaunchAgent para App Nap (se usar auto-start)
- [ ] Reiniciar Chrome para aplicar alterações

## Verificação

```bash
# Testar com tela bloqueada:
# 1. Bloquear tela (Cmd+Ctrl+Q)
# 2. Aguardar 30 segundos
# 3. Executar teste de conexão

node -e "
const puppeteer = require('puppeteer-core')
puppeteer.connect({
  browserURL: 'http://127.0.0.1:9222',
  protocolTimeout: 120000
}).then(b => {
  console.log('✅ Conexão OK com tela bloqueada!')
  process.exit(0)
}).catch(e => {
  console.error('❌ Falhou:', e.message)
  process.exit(1)
})
"
```

## Projetos que usam esta solução

- Bot-X-Reply
- (adicionar outros conforme aplicar)
