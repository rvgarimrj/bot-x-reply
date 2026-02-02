#!/usr/bin/env node

/**
 * Auto-Daemon - Sistema Autonomo de 50+ Replies/Dia
 *
 * Opera 100% autonomamente sem aprovacao manual:
 * - Minimo 50 replies/dia
 * - Normal 70 replies/dia
 * - Maximo 80 replies/dia (anti-bot)
 * - Horario: 8h as 23h59
 * - Resumo diario as 23:30
 */

import 'dotenv/config'
import { writeFileSync, readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import telegram from '../src/telegram.js'
import { discoverTweets } from '../src/discovery.js'
import { generateReplies } from '../src/claude.js'
import { postReply } from '../src/puppeteer.js'
import {
  canPostMore,
  shouldPostReply,
  recordReply,
  recordError,
  getDailyStats,
  getDailyLimits,
  getRecentStyles
} from '../src/finder.js'
import { recordPostedReply } from '../src/knowledge.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Configuracao
const CONFIG = {
  dailyTarget: {
    min: 50,
    normal: 70,
    max: 80
  },
  operatingHours: {
    start: 8,
    end: 24  // Meia-noite
  },
  intervalMinutes: {
    base: 15,
    min: 10,
    max: 25
  },
  highQualityThreshold: 80,
  summary: {
    hour: 23,
    minute: 30
  },
  // Horarios a evitar (outro robo roda nesses horarios)
  // Evita 5 minutos antes e depois de cada horario
  avoidHours: [8, 12, 18, 22, 0], // 8h, 12h, 18h, 22h, meia-noite
  avoidMinuteBuffer: 5 // minutos antes/depois para evitar
}

// Estado do daemon
let isRunning = false
let lastReplyTime = null
let summarySentToday = false
let currentDate = new Date().toDateString()

// Arquivo de estado para persistencia
const STATE_FILE = join(__dirname, '../.auto-daemon-state.json')

/**
 * Salva estado em disco
 */
function saveState() {
  try {
    writeFileSync(STATE_FILE, JSON.stringify({
      lastReplyTime,
      summarySentToday,
      currentDate,
      timestamp: Date.now()
    }))
  } catch (e) {}
}

/**
 * Carrega estado do disco
 */
function loadState() {
  try {
    if (existsSync(STATE_FILE)) {
      const data = JSON.parse(readFileSync(STATE_FILE, 'utf-8'))
      // So usa se for do mesmo dia
      if (data.currentDate === new Date().toDateString()) {
        lastReplyTime = data.lastReplyTime
        summarySentToday = data.summarySentToday
      }
    }
  } catch (e) {}
}

/**
 * Verifica se mudou o dia e reseta estados
 */
function checkDayChange() {
  const today = new Date().toDateString()
  if (currentDate !== today) {
    currentDate = today
    summarySentToday = false
    console.log('\n=== NOVO DIA ===\n')
    saveState()
  }
}

/**
 * Verifica se esta dentro do horario de operacao
 */
function isOperatingHours() {
  const now = new Date()
  const hour = now.getHours()
  return hour >= CONFIG.operatingHours.start && hour < CONFIG.operatingHours.end
}

/**
 * Verifica se estamos em horario de conflito com outro robo
 * Evita 5 minutos antes e depois de cada horario configurado
 */
function isConflictTime() {
  const now = new Date()
  const hour = now.getHours()
  const minute = now.getMinutes()
  const buffer = CONFIG.avoidMinuteBuffer

  for (const avoidHour of CONFIG.avoidHours) {
    // Horario exato (ex: 8:00)
    if (hour === avoidHour && minute < buffer) {
      return { conflict: true, reason: `${avoidHour}h +${minute}min`, waitMinutes: buffer - minute }
    }

    // Antes do horario (ex: 7:55-7:59 para evitar 8:00)
    const hourBefore = avoidHour === 0 ? 23 : avoidHour - 1
    if (hour === hourBefore && minute >= (60 - buffer)) {
      const waitMinutes = (60 - minute) + buffer
      return { conflict: true, reason: `proximo de ${avoidHour}h`, waitMinutes }
    }
  }

  return { conflict: false }
}

/**
 * Verifica se e hora de enviar resumo diario
 */
function isSummaryTime() {
  if (summarySentToday) return false
  const now = new Date()
  return now.getHours() === CONFIG.summary.hour && now.getMinutes() >= CONFIG.summary.minute
}

/**
 * Calcula proximo horario de operacao
 */
function getNextOperatingTime() {
  const now = new Date()
  const next = new Date(now)

  if (now.getHours() >= CONFIG.operatingHours.end) {
    // Ja passou meia-noite, vai pro dia seguinte
    next.setDate(next.getDate() + 1)
  }

  next.setHours(CONFIG.operatingHours.start, 0, 0, 0)
  return next
}

/**
 * Calcula intervalo ate proximo reply baseado no progresso
 */
function calculateNextInterval() {
  const stats = getDailyStats()
  const count = stats.repliesPosted
  const limits = getDailyLimits()

  // Se esta atrasado (abaixo da media esperada), diminui intervalo
  const now = new Date()
  const hoursElapsed = now.getHours() - CONFIG.operatingHours.start
  const totalHours = CONFIG.operatingHours.end - CONFIG.operatingHours.start
  const expectedReplies = Math.floor((limits.normal / totalHours) * hoursElapsed)

  let interval = CONFIG.intervalMinutes.base

  if (count < expectedReplies - 5) {
    // Bem atrasado - intervalo minimo
    interval = CONFIG.intervalMinutes.min
  } else if (count > expectedReplies + 5) {
    // Adiantado - intervalo maximo
    interval = CONFIG.intervalMinutes.max
  }

  // Adiciona variacao aleatoria (+/- 3 min)
  const variance = Math.floor(Math.random() * 7) - 3
  interval = Math.max(CONFIG.intervalMinutes.min, Math.min(CONFIG.intervalMinutes.max, interval + variance))

  return interval
}

/**
 * Envia resumo diario
 */
async function sendDailySummary() {
  try {
    const stats = getDailyStats()
    await telegram.sendDailySummary(stats)
    summarySentToday = true
    saveState()
    console.log('Resumo diario enviado')
  } catch (error) {
    console.error('Erro ao enviar resumo:', error.message)
  }
}

/**
 * Executa um ciclo de reply automatico
 */
async function runReplyCycle() {
  console.log(`\n[${new Date().toLocaleTimeString('pt-BR')}] Iniciando ciclo...`)

  try {
    // Verifica se pode postar mais
    if (!canPostMore()) {
      console.log('Limite diario atingido, aguardando proximo dia')
      return
    }

    // Busca tweets de multiplas fontes
    const tweets = await discoverTweets(5)

    if (!tweets || tweets.length === 0) {
      console.log('Nenhum tweet encontrado neste ciclo')
      return
    }

    // Tenta cada tweet da lista ate conseguir postar
    for (const tweet of tweets) {
      console.log(`Tweet selecionado: @${tweet.author} (score: ${tweet.score})`)

      // Verifica se deve postar baseado no score e progresso
      if (!shouldPostReply(tweet.score)) {
        console.log('Score muito baixo para progresso atual, pulando')
        continue
      }

      // Gera replies com rotacao de estilo
      const lastStyles = getRecentStyles()
      const result = await generateReplies(tweet.text, tweet.author, {
        lastStyles,
        skipResearch: false
      })

      if (!result.success || result.replies.length === 0) {
        console.log('Falha ao gerar replies, tentando proximo tweet')
        continue
      }

      // Usa o primeiro reply (mais alinhado com estilo sugerido)
      const reply = result.replies[0]
      const style = result.suggestedStyle

      console.log(`Reply gerado (${result.language}, estilo: ${style}):`)
      console.log(`"${reply}"`)

      // Posta via Puppeteer
      console.log('Postando via Chrome...')
      const postResult = await postReply(tweet.url, reply)

      // Se replies restritos, tenta proximo tweet
      if (!postResult.success && postResult.skippable) {
        console.log(`⏭️ Pulando para proximo tweet (${postResult.error})`)
        continue
      }

      if (postResult.success) {
        // Registra sucesso
        recordReply(tweet.url, {
          author: tweet.author,
          language: result.language,
          style: style
        })

        recordPostedReply({
          tweetUrl: tweet.url,
          tweetAuthor: tweet.author,
          tweetText: tweet.text,
          replyText: reply,
          replyIndex: 1,
          wasRecommended: true,
          source: tweet.source || 'unknown'
        })

        lastReplyTime = Date.now()
        saveState()

        const stats = getDailyStats()
        console.log(`Reply postado! (${stats.repliesPosted}/${CONFIG.dailyTarget.normal})`)

        // Notificacao desativada - apenas resumo diario as 23:30
        return // Sucesso, sai do loop

      } else {
        console.log('Falha ao postar:', postResult.error)
        recordError(postResult.error)
        return // Erro nao-pulavel, sai do loop
      }
    } // fim do for

    console.log('Nenhum tweet valido encontrado neste ciclo')

  } catch (error) {
    console.error('Erro no ciclo:', error.message)
    recordError(error.message)
  }
}

/**
 * Loop principal
 */
async function mainLoop() {
  while (isRunning) {
    checkDayChange()

    // Verifica hora do resumo
    if (isSummaryTime()) {
      await sendDailySummary()
    }

    if (isOperatingHours()) {
      // Verifica conflito com outro robo (8h, 12h, 18h, 22h, meia-noite)
      const conflict = isConflictTime()
      if (conflict.conflict) {
        console.log(`\n⏳ Evitando conflito: ${conflict.reason}`)
        console.log(`Aguardando ${conflict.waitMinutes + 1} minutos...`)
        await sleep((conflict.waitMinutes + 1) * 60 * 1000)
        continue // Volta pro inicio do loop
      }

      // Executa ciclo
      await runReplyCycle()

      // Calcula proximo intervalo
      const nextInterval = calculateNextInterval()
      console.log(`Proximo ciclo em ${nextInterval} minutos...`)

      // Aguarda
      await sleep(nextInterval * 60 * 1000)

    } else {
      // Fora do horario
      const nextOp = getNextOperatingTime()
      const waitMs = nextOp.getTime() - Date.now()
      const waitHours = Math.round(waitMs / 3600000 * 10) / 10

      console.log(`\nFora do horario. Proximo inicio: ${nextOp.toLocaleString('pt-BR')} (${waitHours}h)`)

      // Verifica a cada 5 minutos
      await sleep(5 * 60 * 1000)
    }
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

/**
 * Inicializa daemon
 */
async function main() {
  console.log('===================================')
  console.log('  AUTO-DAEMON - Bot X Reply')
  console.log('  Sistema Autonomo 50+ Replies/Dia')
  console.log('===================================\n')

  console.log('Configuracao:')
  console.log(`  Meta: ${CONFIG.dailyTarget.min}-${CONFIG.dailyTarget.max} replies/dia`)
  console.log(`  Horario: ${CONFIG.operatingHours.start}h - ${CONFIG.operatingHours.end}h`)
  console.log(`  Intervalo: ${CONFIG.intervalMinutes.min}-${CONFIG.intervalMinutes.max}min`)
  console.log(`  Resumo: ${CONFIG.summary.hour}:${CONFIG.summary.minute}`)
  console.log(`  Evita: ${CONFIG.avoidHours.map(h => h + 'h').join(', ')} (+/-${CONFIG.avoidMinuteBuffer}min)`)
  console.log('')

  // Verifica variaveis de ambiente
  if (!process.env.TELEGRAM_CHAT_ID) {
    console.error('TELEGRAM_CHAT_ID nao configurado')
    process.exit(1)
  }

  // Carrega estado anterior
  loadState()

  // Inicializa Telegram (sem polling - so envia)
  telegram.initBot({ polling: false })
  telegram.setChatId(process.env.TELEGRAM_CHAT_ID)

  isRunning = true

  // Notifica inicio
  const stats = getDailyStats()
  const statusMsg = isOperatingHours()
    ? 'Operando agora'
    : `Aguardando horario (${CONFIG.operatingHours.start}h)`

  await telegram.sendMessage(
    `<b>Auto-Daemon iniciado</b>\n\n` +
    `Meta: ${CONFIG.dailyTarget.normal} replies/dia\n` +
    `Horario: ${CONFIG.operatingHours.start}h - ${CONFIG.operatingHours.end}h\n` +
    `Replies hoje: ${stats.repliesPosted}\n\n` +
    `Status: ${statusMsg}`
  ).catch(() => {})

  console.log('Daemon iniciado!\n')

  // Inicia loop
  await mainLoop()
}

// Handlers de sinal
process.on('SIGINT', async () => {
  console.log('\nEncerrando daemon...')
  isRunning = false
  saveState()

  const stats = getDailyStats()
  await telegram.sendMessage(
    `<b>Auto-Daemon encerrado</b>\n\n` +
    `Replies hoje: ${stats.repliesPosted}`
  ).catch(() => {})

  process.exit(0)
})

process.on('SIGTERM', () => {
  isRunning = false
  saveState()
  process.exit(0)
})

// Inicia
main().catch(error => {
  console.error('Erro fatal:', error)
  process.exit(1)
})
