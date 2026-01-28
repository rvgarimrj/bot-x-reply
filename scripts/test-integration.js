#!/usr/bin/env node

/**
 * Script de teste de integração
 * Verifica se todos os módulos estão funcionando corretamente
 */

import 'dotenv/config'

console.log('🧪 Bot-X-Reply - Teste de Integração\n')
console.log('='.repeat(50))

// 1. Teste de variáveis de ambiente
console.log('\n1️⃣ Verificando variáveis de ambiente...')
const requiredEnvVars = ['TELEGRAM_BOT_TOKEN', 'ANTHROPIC_API_KEY']
const optionalEnvVars = ['TELEGRAM_CHAT_ID', 'X_USERNAME']

let envOk = true
for (const envVar of requiredEnvVars) {
  if (process.env[envVar]) {
    console.log(`   ✅ ${envVar} configurado`)
  } else {
    console.log(`   ❌ ${envVar} FALTANDO`)
    envOk = false
  }
}

for (const envVar of optionalEnvVars) {
  if (process.env[envVar]) {
    console.log(`   ✅ ${envVar} configurado`)
  } else {
    console.log(`   ⚠️  ${envVar} não configurado (opcional)`)
  }
}

// 2. Teste do módulo Claude
console.log('\n2️⃣ Testando módulo Claude...')
try {
  const { detectLanguage, generateReplies } = await import('../src/claude.js')

  // Teste de detecção
  const langTest = detectLanguage('This is a test in English')
  console.log(`   ✅ Detecção de idioma: ${langTest.language} (${langTest.confidence})`)

  // Teste de geração (se API key existe)
  if (process.env.ANTHROPIC_API_KEY) {
    console.log('   🔄 Testando geração de reply...')
    const result = await generateReplies('Testing the AI', 'testuser')
    if (result.success && result.replies.length > 0) {
      console.log(`   ✅ Geração OK: ${result.replies.length} replies`)
      console.log(`      Exemplo: "${result.replies[0].slice(0, 50)}..."`)
    } else {
      console.log(`   ❌ Erro na geração: ${result.error}`)
    }
  }
} catch (error) {
  console.log(`   ❌ Erro: ${error.message}`)
}

// 3. Teste do módulo Telegram
console.log('\n3️⃣ Testando módulo Telegram...')
try {
  const telegram = await import('../src/telegram.js')
  const TelegramBot = (await import('node-telegram-bot-api')).default

  const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN)
  const info = await bot.getMe()
  console.log(`   ✅ Bot conectado: @${info.username}`)

  if (process.env.TELEGRAM_CHAT_ID) {
    console.log(`   ✅ Chat ID configurado: ${process.env.TELEGRAM_CHAT_ID}`)
  } else {
    console.log('   ⚠️  Chat ID não configurado')
    console.log('      Execute: node scripts/reply-bot.js')
    console.log('      E envie /start para o bot no Telegram')
  }
} catch (error) {
  console.log(`   ❌ Erro: ${error.message}`)
}

// 4. Teste do módulo Browser
console.log('\n4️⃣ Testando módulo Browser...')
try {
  const browser = await import('../src/browser.js')

  const extractInst = browser.getExtractTweetInstructions('https://x.com/test/status/123')
  console.log(`   ✅ Instruções de extração: ${extractInst.steps.length} passos`)

  const postInst = browser.getPostReplyInstructions('https://x.com/test/status/123', 'Test reply')
  console.log(`   ✅ Instruções de post: ${postInst.steps.length} passos`)
} catch (error) {
  console.log(`   ❌ Erro: ${error.message}`)
}

// 5. Teste do módulo Finder
console.log('\n5️⃣ Testando módulo Finder...')
try {
  const finder = await import('../src/finder.js')

  const accounts = finder.getAccountsToMonitor()
  console.log(`   ✅ Contas para monitorar: ${accounts.length}`)
  if (accounts.length > 0) {
    console.log(`      Exemplo: @${accounts[0]}`)
  }

  const stats = finder.getDailyStats()
  console.log(`   ✅ Stats do dia: ${stats.repliesPosted} replies`)

  console.log(`   ✅ Pode postar mais: ${finder.canPostMore() ? 'sim' : 'não'}`)
} catch (error) {
  console.log(`   ❌ Erro: ${error.message}`)
}

// 6. Verificação de arquivos de config
console.log('\n6️⃣ Verificando arquivos de configuração...')
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = join(__dirname, '..')

const configFiles = [
  'config/profile.json',
  'config/accounts.json',
  'package.json',
  '.env'
]

for (const file of configFiles) {
  const exists = existsSync(join(rootDir, file))
  console.log(`   ${exists ? '✅' : '❌'} ${file}`)
}

// Resumo
console.log('\n' + '='.repeat(50))
console.log('📊 RESUMO\n')

if (envOk) {
  console.log('✅ Ambiente configurado corretamente')
} else {
  console.log('❌ Configure as variáveis de ambiente faltando no .env')
}

console.log('\n📌 PRÓXIMOS PASSOS:')
if (!process.env.TELEGRAM_CHAT_ID) {
  console.log('1. Execute: npm start')
  console.log('2. Envie /start para @garim_x_reply_bot no Telegram')
  console.log('3. Copie o Chat ID exibido e adicione ao .env')
} else {
  console.log('1. Execute: npm start')
  console.log('2. Envie uma URL de tweet no Telegram')
  console.log('3. Escolha um reply e siga as instruções')
}

console.log('\n🎯 Bot pronto para uso!')
