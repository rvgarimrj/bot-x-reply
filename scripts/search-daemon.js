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
import { writeFileSync, readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import telegram from '../src/telegram.js'
import { findBestTweets, formatTweetCard } from '../src/tweet-finder.js'
import { getDailyStats, canPostMore, recordReply } from '../src/finder.js'
import { cleanOldData, recordPostedReply } from '../src/knowledge.js'
import { generateReplies } from '../src/claude.js'
import { postReply } from '../src/puppeteer.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Arquivos compartilhados para sincronizar com o bot principal
const SHARED_SUGGESTIONS_FILE = join(__dirname, '../.suggestions.json')
const INTERACTION_FILE = join(__dirname, '../.user-interaction.json')

// Configurações
const CONFIG = {
  intervalMinutes: 120,        // 2 horas entre buscas
  startHour: 8,                // Começa às 8h
  endHour: 22,                 // Termina às 22h
  workDays: [0, 1, 2, 3, 4, 5, 6], // Todos os dias (Dom=0, Seg=1, ... Sáb=6)
  maxTweets: 5,                // Máximo de tweets por busca
  timezone: 'America/Sao_Paulo'
}

// Estado
let isRunning = false
let lastSearchTime = null
let pendingSuggestions = []
let suggestionSentAt = null
let autoReplyTimeout = null

// Configuração de auto-reply
const AUTO_REPLY_MINUTES = 10 // Minutos sem resposta para auto-reply

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
 * Verifica se usuário interagiu desde o envio das sugestões
 */
function userHasInteracted() {
  try {
    if (existsSync(INTERACTION_FILE)) {
      const data = JSON.parse(readFileSync(INTERACTION_FILE, 'utf-8'))
      // Se interação foi depois do envio das sugestões, usuário interagiu
      if (data.timestamp && suggestionSentAt && data.timestamp > suggestionSentAt) {
        return true
      }
    }
  } catch (e) {
    // Ignora erros
  }
  return false
}

/**
 * Auto-reply: posta automaticamente o melhor reply após timeout
 */
async function autoReplyBest() {
  // Verifica se usuário já interagiu
  if (userHasInteracted()) {
    console.log('⏰ Auto-reply cancelado: usuário já interagiu')
    pendingSuggestions = []
    suggestionSentAt = null
    return
  }

  if (!pendingSuggestions || pendingSuggestions.length === 0) {
    console.log('⏰ Auto-reply: sem sugestões pendentes')
    return
  }

  // Encontra o melhor tweet (maior score)
  const bestIndex = pendingSuggestions.reduce((best, t, i) =>
    t.score > pendingSuggestions[best].score ? i : best, 0)

  const tweet = pendingSuggestions[bestIndex]

  console.log(`⏰ Auto-reply: ${AUTO_REPLY_MINUTES}min sem resposta, postando automaticamente...`)
  console.log(`📝 Tweet de @${tweet.author} (score: ${tweet.score})`)

  try {
    // Verifica se ainda pode postar
    if (!canPostMore()) {
      console.log('⚠️ Auto-reply cancelado: limite diário atingido')
      await telegram.sendMessage('⚠️ Auto-reply cancelado: limite diário atingido')
      return
    }

    // Gera replies
    await telegram.sendMessage(`⏰ <b>Auto-reply ativado!</b>\n\n${AUTO_REPLY_MINUTES}min sem resposta.\nPostando no tweet de @${tweet.author}...`)

    const result = await generateReplies(tweet.text, tweet.author)

    if (!result.success || result.replies.length === 0) {
      console.log('❌ Auto-reply: erro ao gerar replies')
      return
    }

    // Usa o primeiro reply (mais direto)
    const reply = result.replies[0]

    // Posta via Puppeteer
    const postResult = await postReply(tweet.url, reply)

    if (postResult.success) {
      recordReply(tweet.url)
      recordPostedReply({
        tweetUrl: tweet.url,
        tweetAuthor: tweet.author,
        tweetText: tweet.text,
        replyText: reply,
        replyIndex: 1,
        wasRecommended: true
      })

      const stats = getDailyStats()

      if (postResult.screenshot) {
        await telegram.sendPhoto(postResult.screenshot,
          `✅ <b>Auto-reply postado!</b>\n\n` +
          `📝 @${tweet.author}\n` +
          `💬 "${reply}"\n\n` +
          `📊 Replies hoje: ${stats.repliesPosted}/10`
        )
      } else {
        await telegram.sendMessage(
          `✅ <b>Auto-reply postado!</b>\n\n` +
          `📝 @${tweet.author}\n` +
          `💬 "${reply}"\n\n` +
          `📊 Replies hoje: ${stats.repliesPosted}/10`
        )
      }

      console.log('✅ Auto-reply postado com sucesso!')
    } else {
      await telegram.sendMessage(`❌ Auto-reply falhou: ${postResult.error}`)
    }

  } catch (error) {
    console.error('❌ Erro no auto-reply:', error.message)
    await telegram.sendMessage(`❌ Erro no auto-reply: ${error.message}`)
  }

  // Limpa sugestões pendentes
  pendingSuggestions = []
  suggestionSentAt = null
}

/**
 * Inicia timer de auto-reply
 */
function startAutoReplyTimer() {
  // Cancela timer anterior se existir
  if (autoReplyTimeout) {
    clearTimeout(autoReplyTimeout)
  }

  suggestionSentAt = Date.now()

  // Agenda auto-reply
  autoReplyTimeout = setTimeout(() => {
    autoReplyBest()
  }, AUTO_REPLY_MINUTES * 60 * 1000)

  console.log(`⏰ Auto-reply agendado para ${AUTO_REPLY_MINUTES}min`)
}

/**
 * Cancela timer de auto-reply (quando usuário interage)
 */
function cancelAutoReplyTimer() {
  if (autoReplyTimeout) {
    clearTimeout(autoReplyTimeout)
    autoReplyTimeout = null
    console.log('⏰ Auto-reply cancelado (usuário interagiu)')
  }
  pendingSuggestions = []
  suggestionSentAt = null
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

    // Inicia timer de auto-reply
    startAutoReplyTimer()

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
  console.log(`   Dias: Todos os dias`)
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

  // Inicializa Telegram SEM polling (o bot principal faz polling)
  telegram.initBot({ polling: false })
  telegram.setChatId(process.env.TELEGRAM_CHAT_ID)

  isRunning = true

  // Notifica início
  const now = new Date()
  if (isWorkingHours()) {
    await telegram.sendMessage(
      `🤖 <b>Search Daemon ativo!</b>\n\n` +
      `📅 Todos os dias, ${CONFIG.startHour}h-${CONFIG.endHour}h\n` +
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
