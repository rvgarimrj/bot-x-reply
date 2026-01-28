#!/usr/bin/env node

/**
 * Search Daemon - Busca proativa de tweets
 *
 * Configuração:
 * - Segunda a Sexta apenas
 * - 8h às 22h apenas
 * - Intervalo de 2 horas entre buscas
 * - Se não interagir, ignora e busca novos no próximo ciclo
 */

import 'dotenv/config'
import { writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import telegram from '../src/telegram.js'
import { findBestTweets, formatTweetCard } from '../src/tweet-finder.js'
import { getDailyStats, canPostMore } from '../src/finder.js'
import { cleanOldData } from '../src/knowledge.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Arquivo compartilhado para sincronizar com o bot principal
const SHARED_SUGGESTIONS_FILE = join(__dirname, '../.suggestions.json')

// Configurações
const CONFIG = {
  intervalMinutes: 120,        // 2 horas entre buscas
  startHour: 8,                // Começa às 8h
  endHour: 22,                 // Termina às 22h
  workDays: [1, 2, 3, 4, 5],   // Seg=1, Ter=2, ... Sex=5
  maxTweets: 5,                // Máximo de tweets por busca
  timezone: 'America/Sao_Paulo'
}

// Estado
let isRunning = false
let lastSearchTime = null
let pendingSuggestions = []

/**
 * Verifica se está dentro do horário de trabalho
 */
function isWorkingHours() {
  const now = new Date()
  const hour = now.getHours()
  const dayOfWeek = now.getDay() // 0=Dom, 1=Seg, ..., 6=Sab

  const isWorkDay = CONFIG.workDays.includes(dayOfWeek)
  const isWorkHour = hour >= CONFIG.startHour && hour < CONFIG.endHour

  return isWorkDay && isWorkHour
}

/**
 * Retorna próximo horário de trabalho
 */
function getNextWorkingTime() {
  const now = new Date()
  let next = new Date(now)

  // Se hoje é dia útil
  if (CONFIG.workDays.includes(now.getDay())) {
    // Se ainda não começou, espera começar
    if (now.getHours() < CONFIG.startHour) {
      next.setHours(CONFIG.startHour, 0, 0, 0)
      return next
    }
    // Se já passou, vai pro próximo dia
    if (now.getHours() >= CONFIG.endHour) {
      next.setDate(next.getDate() + 1)
    }
  }

  // Encontra próximo dia útil
  while (!CONFIG.workDays.includes(next.getDay())) {
    next.setDate(next.getDate() + 1)
  }

  next.setHours(CONFIG.startHour, 0, 0, 0)
  return next
}

/**
 * Formata tempo restante
 */
function formatTimeUntil(date) {
  const diff = date.getTime() - Date.now()
  const hours = Math.floor(diff / 3600000)
  const minutes = Math.floor((diff % 3600000) / 60000)

  if (hours > 24) {
    const days = Math.floor(hours / 24)
    return `${days}d ${hours % 24}h`
  }
  if (hours > 0) {
    return `${hours}h ${minutes}min`
  }
  return `${minutes}min`
}

/**
 * Executa busca e notifica
 */
async function runSearch() {
  console.log(`\n🔍 [${new Date().toLocaleTimeString('pt-BR')}] Iniciando busca...`)

  try {
    // Verifica se pode postar mais
    if (!canPostMore()) {
      console.log('⚠️ Limite diário atingido, pulando busca')
      return
    }

    const tweets = await findBestTweets(CONFIG.maxTweets)

    if (!tweets || tweets.length === 0) {
      console.log('😕 Nenhum tweet relevante encontrado')
      return
    }

    // Encontra o melhor
    const bestIndex = tweets.reduce((best, t, i) =>
      t.score > tweets[best].score ? i : best, 0)

    // Monta mensagem com cards visuais
    let msg = `🎯 <b>Encontrei ${tweets.length} tweets para engajar:</b>\n`

    tweets.forEach((tweet, i) => {
      const isBest = i === bestIndex
      msg += `\n${formatTweetCard(tweet, i + 1, isBest)}\n`
    })

    const stats = getDailyStats()
    msg += `\n━━━━━━━━━━━━━━━━━━━━\n`
    msg += `📊 Replies hoje: ${stats.repliesPosted}/10\n`
    msg += `💡 <i>⭐ = melhor oportunidade</i>`

    // Botões
    const buttons = tweets.map((_, i) => ({
      text: i === bestIndex ? `⭐ ${i + 1}` : `${i + 1}`,
      callback_data: `select_found_${i}`
    }))

    const keyboard = {
      inline_keyboard: [
        buttons,
        [
          { text: '🔄 Buscar Novos', callback_data: 'search_again' },
          { text: '❌ Ignorar', callback_data: 'cancel' }
        ]
      ]
    }

    // Salva tweets pendentes (para o bot principal usar)
    pendingSuggestions = tweets

    // Salva em arquivo compartilhado para o bot principal ler
    try {
      writeFileSync(SHARED_SUGGESTIONS_FILE, JSON.stringify({
        tweets,
        timestamp: Date.now()
      }))
      console.log('💾 Sugestões salvas em arquivo compartilhado')
    } catch (e) {
      console.error('Erro ao salvar sugestões:', e.message)
    }

    // Envia notificação
    await telegram.sendMessage(msg, { reply_markup: keyboard })

    console.log(`✅ Notificado: ${tweets.length} tweets`)
    lastSearchTime = Date.now()

  } catch (error) {
    console.error('❌ Erro na busca:', error.message)

    // Se for erro de Chrome, notifica
    if (error.message.includes('9222')) {
      await telegram.sendMessage(
        '⚠️ <b>Daemon:</b> Chrome não está na porta 9222.\n\n' +
        'Execute: <code>./scripts/start-chrome.sh</code>'
      ).catch(() => {})
    }
  }
}

/**
 * Loop principal
 */
async function mainLoop() {
  while (isRunning) {
    if (isWorkingHours()) {
      await runSearch()

      // Aguarda intervalo
      const waitMs = CONFIG.intervalMinutes * 60 * 1000
      console.log(`⏰ Próxima busca em ${CONFIG.intervalMinutes} minutos...`)
      await sleep(waitMs)
    } else {
      // Fora do horário - calcula quando volta
      const nextWork = getNextWorkingTime()
      console.log(`😴 Fora do horário. Próxima busca: ${nextWork.toLocaleString('pt-BR')} (${formatTimeUntil(nextWork)})`)

      // Espera até próximo horário (verifica a cada 5 min)
      while (!isWorkingHours() && isRunning) {
        await sleep(5 * 60 * 1000)
      }
    }
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

/**
 * Inicializa
 */
async function main() {
  console.log('🤖 Search Daemon iniciando...')
  console.log('')
  console.log('📅 Configuração:')
  console.log(`   Dias: Seg a Sex`)
  console.log(`   Horário: ${CONFIG.startHour}h às ${CONFIG.endHour}h`)
  console.log(`   Intervalo: ${CONFIG.intervalMinutes} minutos`)
  console.log('')

  // Limpa dados antigos da base de conhecimento (mantém só 6 meses)
  const removed = cleanOldData()
  if (removed > 0) {
    console.log(`🧹 Limpeza: ${removed} registros antigos removidos`)
  }

  if (!process.env.TELEGRAM_CHAT_ID) {
    console.error('❌ TELEGRAM_CHAT_ID não configurado')
    process.exit(1)
  }

  // Inicializa Telegram
  telegram.initBot({ polling: false })
  telegram.setChatId(process.env.TELEGRAM_CHAT_ID)

  isRunning = true

  // Notifica início
  const now = new Date()
  if (isWorkingHours()) {
    await telegram.sendMessage(
      `🤖 <b>Search Daemon ativo!</b>\n\n` +
      `📅 Seg-Sex, ${CONFIG.startHour}h-${CONFIG.endHour}h\n` +
      `⏰ Buscas a cada ${CONFIG.intervalMinutes} minutos\n\n` +
      `Primeira busca começando...`
    )
  } else {
    const nextWork = getNextWorkingTime()
    await telegram.sendMessage(
      `🤖 <b>Search Daemon ativo!</b>\n\n` +
      `😴 Fora do horário agora.\n` +
      `⏰ Próxima busca: ${nextWork.toLocaleString('pt-BR')}`
    )
  }

  // Inicia loop
  await mainLoop()
}

// Handlers de sinal
process.on('SIGINT', async () => {
  console.log('\n👋 Encerrando daemon...')
  isRunning = false
  await telegram.sendMessage('👋 Search Daemon encerrado.').catch(() => {})
  process.exit(0)
})

process.on('SIGTERM', () => {
  isRunning = false
  process.exit(0)
})

main().catch(console.error)
