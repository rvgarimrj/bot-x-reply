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
import { recordPostedReply, recordSourceOutcome, recordAppOutcome, getBestSources, getBestPerformingApps } from '../src/knowledge.js'
import * as targeting from '../src/targeting.js'

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
  // Intervalos base (serão ajustados por horário de pico)
  intervalMinutes: {
    base: 14,
    min: 8,
    max: 25
  },

  // ============================================================
  // HORÁRIOS OTIMIZADOS BR + USA (v2 - 2026-02-03)
  // Baseado em: Sprout Social 2025, Buffer 2025, nossos dados
  // ============================================================
  // Conversão: 12h BR = 10h EST, 21h BR = 19h EST
  peakHours: {
    // GOLD: Ambos BR + USA em horário de pico
    // 12-14h BR = 10h-12h EST (manhã/almoço USA)
    // 20-21h BR = 18-19h EST (fim do dia USA)
    gold: [12, 13, 14, 20, 21],

    // HIGH: Pelo menos um em horário de pico
    high: [11, 15, 16, 17, 19, 22],

    // MEDIUM: Ambos ativos mas não pico
    medium: [10, 18, 23],

    // LOW: Apenas BR ativo
    low: [8, 9]
  },

  // Intervalos por tipo de horário
  peakIntervals: {
    gold: { min: 8, base: 10, max: 12 },    // MÁXIMO esforço
    high: { min: 10, base: 12, max: 15 },   // Alto esforço
    medium: { min: 12, base: 15, max: 18 }, // Esforço normal
    low: { min: 18, base: 22, max: 25 }     // Economiza para horários melhores
  },

  // Multiplicadores por dia da semana (0=Dom, 6=Sab)
  dayMultipliers: {
    0: 0.8,  // Domingo - nossos dados mostram 3.7 avg! Testar mais
    1: 1.0,  // Segunda
    2: 1.3,  // Terça - MELHOR
    3: 1.3,  // Quarta - MELHOR
    4: 1.3,  // Quinta - MELHOR
    5: 1.0,  // Sexta
    6: 0.7   // Sábado - pior engajamento
  },

  highQualityThreshold: 80,
  summary: {
    hour: 23,
    minute: 30
  },
  // Horarios a evitar (outro robo roda nesses horarios)
  avoidHours: [8, 12, 18, 22, 0],
  avoidMinuteBuffer: 5
}

// Estado do daemon
let isRunning = false
let lastReplyTime = null
let lastTargetingSync = null
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
 * Evita TODOS os horarios redondos (:00) ±3 minutos
 * (outro robô posta nos minutos :00 de cada hora)
 */
function isConflictTime() {
  const now = new Date()
  const minute = now.getMinutes()
  const hour = now.getHours()

  // Evita minutos 57-59 e 00-02 (±3 min do :00)
  if (minute >= 57 || minute <= 2) {
    const waitMinutes = minute >= 57 ? (60 - minute) + 3 : 3 - minute
    return { conflict: true, reason: `horário redondo ${hour}:00`, waitMinutes }
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
 * Verifica se precisa sincronizar targeting (a cada 6h)
 */
function needsTargetingSync() {
  if (!lastTargetingSync) return true
  const hoursSinceSync = (Date.now() - lastTargetingSync) / (1000 * 60 * 60)
  return hoursSinceSync >= 6
}

/**
 * Sincroniza dados de targeting com API
 */
async function syncTargeting() {
  try {
    console.log('Sincronizando targeting...')
    const result = await targeting.syncTargetingData()
    lastTargetingSync = Date.now()

    if (result.success) {
      console.log(`Targeting: ${result.appsCount} apps sincronizados`)
    } else if (result.usingCache) {
      console.log(`Targeting: usando cache (${result.appsCount} apps)`)
    } else {
      console.log(`Targeting: erro - ${result.error}`)
    }
  } catch (e) {
    console.log('Targeting sync erro:', e.message)
  }
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
 * Retorna o tipo de horário atual (high/medium/low)
 * Baseado nos horários de pico configurados
 */
/**
 * Retorna o tipo de horário atual (gold/high/medium/low)
 * GOLD = BR + USA em pico simultâneo (máximo esforço!)
 */
function getCurrentPeakType() {
  const hour = new Date().getHours()

  // GOLD: Horários de ouro - ambos mercados ativos em pico
  if (CONFIG.peakHours.gold?.includes(hour)) return 'gold'
  if (CONFIG.peakHours.high.includes(hour)) return 'high'
  if (CONFIG.peakHours.medium.includes(hour)) return 'medium'
  return 'low'
}

/**
 * Retorna o multiplicador do dia da semana atual
 * Ter/Qua/Qui = 1.3x (mais replies)
 * Sab = 0.7x (menos replies)
 */
function getDayMultiplier() {
  const day = new Date().getDay()
  return CONFIG.dayMultipliers?.[day] || 1.0
}

/**
 * Retorna intervalos otimizados para o horário atual
 */
function getOptimalIntervalConfig() {
  const peakType = getCurrentPeakType()
  return CONFIG.peakIntervals[peakType] || CONFIG.peakIntervals.medium
}

/**
 * Calcula intervalo ate proximo reply baseado no progresso, horário e dia
 *
 * Lógica:
 * 1. Pega intervalos base do horário atual (gold/high/medium/low)
 * 2. Ajusta pelo multiplicador do dia (Ter/Qua/Qui = mais replies)
 * 3. Ajusta baseado no progresso (atrasado = menor, adiantado = maior)
 * 4. Adiciona variação aleatória
 */
function calculateNextInterval() {
  const stats = getDailyStats()
  const count = stats.repliesPosted
  const limits = getDailyLimits()

  // Pega config de intervalo para o horário atual
  const intervalConfig = getOptimalIntervalConfig()
  const peakType = getCurrentPeakType()
  const dayMultiplier = getDayMultiplier()
  const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab']
  const dayName = dayNames[new Date().getDay()]

  // Calcula progresso esperado (ajustado pelo dia)
  const now = new Date()
  const hoursElapsed = now.getHours() - CONFIG.operatingHours.start
  const totalHours = CONFIG.operatingHours.end - CONFIG.operatingHours.start
  // Em dias melhores (Ter/Qua/Qui), esperamos mais replies
  const adjustedTarget = Math.floor(limits.normal * dayMultiplier)
  const expectedReplies = Math.floor((adjustedTarget / totalHours) * hoursElapsed)

  let interval = intervalConfig.base

  // Ajusta baseado no progresso
  if (count < expectedReplies - 5) {
    // Bem atrasado - intervalo mínimo do período
    interval = intervalConfig.min
  } else if (count > expectedReplies + 5) {
    // Adiantado - intervalo máximo do período
    interval = intervalConfig.max
  }

  // Adiciona variação aleatória (+/- 2 min)
  const variance = Math.floor(Math.random() * 5) - 2
  interval = Math.max(intervalConfig.min, Math.min(intervalConfig.max, interval + variance))

  // Log detalhado para debug
  const peakEmoji = { gold: '🥇', high: '🔥', medium: '📈', low: '📉' }
  console.log(`Intervalo: ${interval}min | ${peakEmoji[peakType] || '•'} ${peakType.toUpperCase()} | ${dayName} (${dayMultiplier}x) | ${count}/${expectedReplies} replies`)

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
          source: tweet.source || 'unknown',
          language: result.language,
          style: style,
          score: tweet.score
        })

        // Registra fonte para learning system
        recordSourceOutcome({
          source: tweet.source || 'unknown',
          inspirationCountry: tweet.inspirationCountry,
          inspirationTab: tweet.inspirationTab,
          score: tweet.score
        })

        // Registra app outcome se tweet tem targeting
        if (tweet.targetApp) {
          // Registra localmente
          recordAppOutcome(tweet.targetApp, {
            matched: true,
            replied: true
          })

          // Envia feedback para API (async, não bloqueia)
          const tweetId = tweet.url.split('/').pop()
          targeting.sendFeedback(tweet.targetApp, tweetId, 'replied', {
            locale: result.language === 'pt' ? 'pt-BR' : 'en-US',
            searchQuery: tweet.targetKeyword,
            reason: `Score: ${tweet.score}, Source: ${tweet.source}`
          }).catch(() => {}) // Ignora erros de feedback

          console.log(`App targeting: ${tweet.targetApp} (urgency: ${tweet.targetAppUrgency || 'N/A'})`)
        }

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

      // Sync targeting se necessário (a cada 6h)
      if (needsTargetingSync()) {
        await syncTargeting()
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
  console.log(`  Intervalos por pico:`)
  console.log(`    - High (${CONFIG.peakHours.high.join(',')}h): ${CONFIG.peakIntervals.high.min}-${CONFIG.peakIntervals.high.max}min`)
  console.log(`    - Medium (${CONFIG.peakHours.medium.join(',')}h): ${CONFIG.peakIntervals.medium.min}-${CONFIG.peakIntervals.medium.max}min`)
  console.log(`    - Low: ${CONFIG.peakIntervals.low.min}-${CONFIG.peakIntervals.low.max}min`)
  console.log(`  Resumo: ${CONFIG.summary.hour}:${CONFIG.summary.minute}`)
  console.log(`  Evita: ${CONFIG.avoidHours.map(h => h + 'h').join(', ')} (+/-${CONFIG.avoidMinuteBuffer}min)`)

  // Mostra melhores fontes aprendidas
  const bestSources = getBestSources(3)
  if (bestSources.length > 0) {
    console.log('\nMelhores fontes (learning):')
    bestSources.forEach((s, i) => {
      console.log(`  ${i + 1}. ${s.source} (${s.posts} posts, ${s.authorReplyRate * 100}% author replies)`)
    })
  }

  // Mostra melhores apps
  const bestApps = getBestPerformingApps(3)
  if (bestApps.length > 0) {
    console.log('\nMelhores apps (targeting):')
    bestApps.forEach((a, i) => {
      console.log(`  ${i + 1}. ${a.slug} (${a.replies} replies, ${a.authorReplyRate * 100}% author replies)`)
    })
  }
  console.log('')

  // Sync inicial de targeting
  console.log('Sincronizando targeting...')
  await syncTargeting()

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
