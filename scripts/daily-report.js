#!/usr/bin/env node

/**
 * Daily Report - Relatório Completo de Aprendizado
 *
 * Este é o "cérebro" do sistema. Roda 00:05 (após meia-noite) para:
 * 1. Analisar TUDO que aconteceu no dia anterior
 * 2. Identificar o que funcionou melhor e pior
 * 3. Comparar com dias anteriores
 * 4. Gerar insights e aprendizados
 * 5. Documentar tudo para persistência
 * 6. Decidir se precisa reiniciar daemon
 * 7. Enviar relatório completo via Telegram
 *
 * Uso:
 *   node scripts/daily-report.js           # Relatório completo + Telegram
 *   node scripts/daily-report.js --dry-run # Só mostra, não envia
 *   node scripts/daily-report.js --force   # Força mesmo se já rodou hoje
 */

import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

// Importa funções de validação de horários
import {
  analyzeHourPerformance,
  rankHoursByPerformance,
  rankDaysByPerformance,
  compareWithConfig,
  generateTelegramSection as generateHoursTelegramSection
} from './validate-hours.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '..', 'data')
const LOGS_DIR = path.join(__dirname, '..', 'logs')
const CONFIG_DIR = path.join(__dirname, '..', 'config')

// Arquivos de dados
const KNOWLEDGE_PATH = path.join(DATA_DIR, 'knowledge.json')
const LEARNINGS_PATH = path.join(DATA_DIR, 'learnings.json')
const STRATEGY_PATH = path.join(DATA_DIR, 'strategy-adjustments.json')
const DAILY_REPORTS_PATH = path.join(DATA_DIR, 'daily-reports.json')
const NIGHTLY_ANALYTICS_PATH = path.join(DATA_DIR, 'nightly-analytics.json')
const REPORT_HISTORY_PATH = path.join(DATA_DIR, 'report-history.json')
const GOALS_PATH = path.join(DATA_DIR, 'goals-tracking.json')
const PEAK_HOURS_PATH = path.join(CONFIG_DIR, 'peak-hours.json')

// ============================================================
// METAS DE MONETIZAÇÃO (PRIORIDADE #1!)
// ============================================================
const MONETIZATION_GOALS = {
  premiumFollowers: 500,      // Meta principal!
  verifiedFollowers: 2000,
  impressions3Months: 5000000,
  dailyFollowerGain: 10,      // Ideal para atingir em ~50 dias
  dailyImpressions: 50000,
  authorReplyRate: 15         // Mínimo para crescimento saudável
}

const COLORS = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m'
}

// ============================================================
// FUNÇÕES DE CARREGAMENTO
// ============================================================

function loadJSON(filePath, defaultValue = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return defaultValue
  }
}

function saveJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

// ============================================================
// TRACKING DE METAS (PRIORIDADE #1!)
// ============================================================

/**
 * Analisa progresso em direção às metas de monetização
 */
function analyzeGoalsProgress() {
  // Carrega dados do X Analytics
  const nightlyData = loadJSON(NIGHTLY_ANALYTICS_PATH, { entries: [] })
  const goalsData = loadJSON(GOALS_PATH, { history: [], projections: {} })

  // Pega última entrada do nightly analytics
  const latestEntry = nightlyData.entries?.[nightlyData.entries.length - 1]
  if (!latestEntry?.parsed) {
    return {
      error: 'Sem dados do X Analytics',
      currentFollowers: null,
      progress: null
    }
  }

  const current = latestEntry.parsed
  const currentFollowers = current.followers || 0
  const verifiedFollowers = 156 // Do texto raw: "Seguidores verificados 156 / 1K"

  // Calcula ganho de seguidores
  let followerGain = 0
  let avgDailyGain = 0
  const history = goalsData.history || []

  if (history.length > 0) {
    const lastEntry = history[history.length - 1]
    followerGain = currentFollowers - (lastEntry.followers || 0)

    // Média dos últimos 7 dias
    const last7 = history.slice(-7)
    if (last7.length >= 2) {
      const totalGain = currentFollowers - (last7[0].followers || currentFollowers)
      avgDailyGain = totalGain / last7.length
    }
  }

  // Calcula projeções
  const followersNeeded = MONETIZATION_GOALS.premiumFollowers - currentFollowers
  let daysTo500 = null
  let estimatedDate500 = null
  let status = 'critical'

  if (avgDailyGain > 0) {
    daysTo500 = Math.ceil(followersNeeded / avgDailyGain)
    const date = new Date()
    date.setDate(date.getDate() + daysTo500)
    estimatedDate500 = date.toISOString().split('T')[0]

    if (daysTo500 <= 30) status = 'excellent'
    else if (daysTo500 <= 60) status = 'good'
    else if (daysTo500 <= 90) status = 'slow'
    else status = 'critical'
  } else if (avgDailyGain < 0) {
    status = 'losing'
  }

  // Atualiza histórico
  const today = new Date().toISOString().split('T')[0]
  const existsToday = history.some(h => h.date === today)
  if (!existsToday) {
    history.push({
      date: today,
      followers: currentFollowers,
      verifiedFollowers,
      impressions: current.impressions || 0,
      engagementRate: current.engagementRate || 0,
      profileVisits: current.profileVisits || 0,
      followerChange: followerGain,
      source: 'daily-report'
    })
    goalsData.history = history.slice(-90) // Últimos 90 dias
  }

  // Atualiza projeções
  goalsData.projections = {
    lastCalculated: new Date().toISOString(),
    currentFollowers,
    verifiedFollowers,
    avgDailyGain: avgDailyGain.toFixed(1),
    daysTo500,
    estimatedDate500,
    status,
    followersNeeded,
    impressions: current.impressions,
    impressionsGoalDaily: MONETIZATION_GOALS.dailyImpressions,
    impressionsOnTrack: (current.impressions || 0) >= MONETIZATION_GOALS.dailyImpressions
  }

  // Salva
  saveJSON(GOALS_PATH, goalsData)

  return {
    currentFollowers,
    verifiedFollowers,
    followersNeeded,
    followerGain,
    avgDailyGain,
    daysTo500,
    estimatedDate500,
    status,
    impressions: current.impressions,
    impressionsOnTrack: (current.impressions || 0) >= MONETIZATION_GOALS.dailyImpressions,
    engagementRate: current.engagementRate,
    profileVisits: current.profileVisits,
    history: history.slice(-7)
  }
}

/**
 * Gera seção de metas para o relatório
 */
function formatGoalsSection(goals) {
  if (goals.error) {
    return {
      console: `\n${COLORS.red}━━━ METAS: ${goals.error} ━━━${COLORS.reset}`,
      telegram: `\n⚠️ <b>Metas:</b> ${goals.error}`
    }
  }

  const statusEmoji = {
    excellent: '🚀',
    good: '✅',
    slow: '🟡',
    critical: '🔴',
    losing: '💀'
  }

  const statusText = {
    excellent: 'Excelente! Meta em menos de 30 dias',
    good: 'Bom ritmo, meta em ~60 dias',
    slow: 'Lento, meta em ~90 dias',
    critical: 'CRÍTICO! Sem crescimento',
    losing: 'PERDENDO SEGUIDORES!'
  }

  // Console
  let console = `\n${COLORS.bold}${COLORS.magenta}━━━ 🎯 PROGRESSO DAS METAS ━━━${COLORS.reset}\n`
  console += `\n  ${statusEmoji[goals.status]} STATUS: ${COLORS.bold}${statusText[goals.status]}${COLORS.reset}\n`
  console += `\n  📊 SEGUIDORES:\n`
  console += `     Atual: ${COLORS.bold}${goals.currentFollowers}${COLORS.reset} / 500 Premium\n`
  console += `     Faltam: ${goals.followersNeeded}\n`
  console += `     Ganho hoje: ${goals.followerGain >= 0 ? '+' : ''}${goals.followerGain}\n`
  console += `     Média/dia: ${goals.avgDailyGain >= 0 ? '+' : ''}${goals.avgDailyGain}\n`

  if (goals.daysTo500) {
    console += `     Previsão: ${goals.daysTo500} dias (${goals.estimatedDate500})\n`
  } else {
    console += `     Previsão: ${COLORS.red}NUNCA (sem crescimento)${COLORS.reset}\n`
  }

  console += `\n  📈 IMPRESSÕES:\n`
  console += `     Hoje: ${(goals.impressions || 0).toLocaleString()}\n`
  console += `     Meta/dia: ${MONETIZATION_GOALS.dailyImpressions.toLocaleString()}\n`
  console += `     Status: ${goals.impressionsOnTrack ? '✅ No caminho' : '❌ Abaixo'}\n`

  console += `\n  🔓 VERIFIED FOLLOWERS: ${goals.verifiedFollowers} / 2000\n`

  // Telegram
  let telegram = `\n🎯 <b>METAS DE MONETIZAÇÃO:</b>\n`
  telegram += `${statusEmoji[goals.status]} <b>${statusText[goals.status]}</b>\n\n`
  telegram += `📊 <b>Seguidores:</b> ${goals.currentFollowers}/500\n`
  telegram += `• Faltam: ${goals.followersNeeded}\n`
  telegram += `• Hoje: ${goals.followerGain >= 0 ? '+' : ''}${goals.followerGain}\n`
  telegram += `• Média/dia: ${goals.avgDailyGain >= 0 ? '+' : ''}${goals.avgDailyGain}\n`

  if (goals.daysTo500) {
    telegram += `• Previsão: ${goals.daysTo500} dias\n`
  } else {
    telegram += `• Previsão: ❌ NUNCA\n`
  }

  telegram += `\n📈 <b>Impressões:</b> ${goals.impressionsOnTrack ? '✅' : '❌'} ${(goals.impressions || 0).toLocaleString()}/dia\n`

  return { console, telegram }
}

/**
 * Gera ajustes automáticos baseados no progresso das METAS
 * Esta é a função mais importante - ela decide O QUE MUDAR para atingir as metas
 */
function generateGoalBasedAdjustments(goalsProgress, analysis) {
  const adjustments = []

  // STATUS CRÍTICO: Não estamos ganhando seguidores
  if (goalsProgress.status === 'critical' || goalsProgress.status === 'losing') {
    adjustments.push({
      icon: '🔴',
      priority: 'critical',
      message: 'CRÍTICO: Sem crescimento de seguidores!',
      action: 'Precisamos de author replies para boost algorítmico'
    })

    // Se author reply rate é 0%, esse é o problema
    if (parseFloat(analysis.authorReplyRate) < 5) {
      adjustments.push({
        icon: '💡',
        priority: 'high',
        message: `Author reply rate: ${analysis.authorReplyRate}% → Precisamos de >15%`,
        action: 'Aumentar perguntas genuínas nos replies'
      })
    }

    // Replies muito longos não geram resposta
    if (analysis.avgLength > 100) {
      adjustments.push({
        icon: '📏',
        priority: 'high',
        message: `Replies médios: ${analysis.avgLength} chars → Reduzir para <80`,
        action: 'Replies curtos + pergunta = mais respostas'
      })
    }

    // Poucas perguntas
    if (parseFloat(analysis.questionRate) < 40) {
      adjustments.push({
        icon: '❓',
        priority: 'high',
        message: `Perguntas: ${analysis.questionRate}% → Aumentar para >50%`,
        action: 'Perguntas geram 3x mais respostas que afirmações'
      })
    }
  }

  // STATUS LENTO: Vamos atingir, mas demora muito
  if (goalsProgress.status === 'slow') {
    adjustments.push({
      icon: '🟡',
      priority: 'medium',
      message: `Ritmo lento: ${goalsProgress.daysTo500} dias para 500 followers`,
      action: 'Precisamos acelerar - focar em contas maiores'
    })

    // Sugerir priorizar contas com mais seguidores
    adjustments.push({
      icon: '🎯',
      priority: 'medium',
      message: 'Priorizar tweets de contas com >100k followers',
      action: 'Maior audiência = mais visibilidade por reply'
    })
  }

  // Impressões OK mas conversão baixa = problema de QUALIDADE
  if (goalsProgress.impressionsOnTrack && goalsProgress.avgDailyGain < 5) {
    adjustments.push({
      icon: '🔍',
      priority: 'high',
      message: 'Impressões OK mas poucos novos seguidores',
      action: 'Problema de conversão: replies não estão gerando interesse no perfil'
    })
  }

  // Sugestões baseadas no ganho diário
  if (goalsProgress.followerGain < 0) {
    adjustments.push({
      icon: '💀',
      priority: 'critical',
      message: `PERDEMOS ${Math.abs(goalsProgress.followerGain)} seguidores hoje!`,
      action: 'Revisar urgentemente: replies podem estar parecendo spam/bot'
    })
  } else if (goalsProgress.followerGain === 0) {
    adjustments.push({
      icon: '⚠️',
      priority: 'high',
      message: 'Zero novos seguidores hoje',
      action: 'Focar em tweets de autores que respondem comments'
    })
  } else if (goalsProgress.followerGain > 0 && goalsProgress.followerGain < MONETIZATION_GOALS.dailyFollowerGain) {
    adjustments.push({
      icon: '📈',
      priority: 'medium',
      message: `+${goalsProgress.followerGain} seguidores (meta: +${MONETIZATION_GOALS.dailyFollowerGain}/dia)`,
      action: 'Bom progresso, mas pode melhorar'
    })
  } else if (goalsProgress.followerGain >= MONETIZATION_GOALS.dailyFollowerGain) {
    adjustments.push({
      icon: '🚀',
      priority: 'info',
      message: `EXCELENTE! +${goalsProgress.followerGain} seguidores hoje!`,
      action: 'Manter estratégia atual!'
    })
  }

  return adjustments
}

// ============================================================
// ANÁLISE DO DIA
// ============================================================

/**
 * Analisa todos os replies do dia anterior
 */
function analyzeYesterdayReplies(knowledge) {
  const replies = knowledge.replies || []

  // Data de ontem (o script roda 00:05, então "ontem" é o dia que acabou)
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = yesterday.toISOString().split('T')[0]

  // Filtra replies de ontem
  const yesterdayReplies = replies.filter(r => {
    if (!r.timestamp) return false
    return r.timestamp.startsWith(yesterdayStr)
  })

  if (yesterdayReplies.length === 0) {
    return { error: 'Nenhum reply encontrado para ontem', date: yesterdayStr }
  }

  // Análise detalhada
  const analysis = {
    date: yesterdayStr,
    totalReplies: yesterdayReplies.length,
    withMetrics: 0,
    totalLikes: 0,
    totalAuthorReplies: 0,
    avgLength: 0,
    questionsCount: 0,

    // Performance por fonte
    bySource: {},

    // Performance por hora
    byHour: {},

    // Performance por estilo
    byStyle: {},

    // Performance por tamanho
    byLength: {
      short: { count: 0, likes: 0, authorReplies: 0 },   // < 80 chars
      medium: { count: 0, likes: 0, authorReplies: 0 },  // 80-120 chars
      long: { count: 0, likes: 0, authorReplies: 0 }     // > 120 chars
    },

    // Melhores e piores
    bestReply: null,
    worstReply: null,
    mostEngaged: null,

    // Lista de autores que responderam
    authorResponses: []
  }

  let totalLength = 0

  for (const reply of yesterdayReplies) {
    totalLength += reply.replyText?.length || 0

    // Conta perguntas
    if (reply.replyText?.includes('?')) {
      analysis.questionsCount++
    }

    // Hora do reply
    const hour = new Date(reply.timestamp).getHours()
    if (!analysis.byHour[hour]) {
      analysis.byHour[hour] = { count: 0, likes: 0, authorReplies: 0 }
    }
    analysis.byHour[hour].count++

    // Fonte do reply
    const source = reply.source || 'unknown'
    if (!analysis.bySource[source]) {
      analysis.bySource[source] = { count: 0, likes: 0, authorReplies: 0 }
    }
    analysis.bySource[source].count++

    // Estilo do reply
    const style = reply.style || 'unknown'
    if (!analysis.byStyle[style]) {
      analysis.byStyle[style] = { count: 0, likes: 0, authorReplies: 0 }
    }
    analysis.byStyle[style].count++

    // Tamanho do reply
    const len = reply.replyText?.length || 0
    const sizeCategory = len < 80 ? 'short' : len <= 120 ? 'medium' : 'long'
    analysis.byLength[sizeCategory].count++

    // Se tem métricas coletadas
    if (reply.metrics?.likes !== null && reply.metrics?.likes !== undefined) {
      analysis.withMetrics++
      analysis.totalLikes += reply.metrics.likes || 0

      // Atualiza por hora
      analysis.byHour[hour].likes += reply.metrics.likes || 0

      // Atualiza por fonte
      analysis.bySource[source].likes += reply.metrics.likes || 0

      // Atualiza por estilo
      analysis.byStyle[style].likes += reply.metrics.likes || 0

      // Atualiza por tamanho
      analysis.byLength[sizeCategory].likes += reply.metrics.likes || 0

      // Author replied?
      if (reply.metrics.authorReplied) {
        analysis.totalAuthorReplies++
        analysis.byHour[hour].authorReplies++
        analysis.bySource[source].authorReplies++
        analysis.byStyle[style].authorReplies++
        analysis.byLength[sizeCategory].authorReplies++

        analysis.authorResponses.push({
          author: reply.tweetAuthor,
          replyText: reply.replyText?.slice(0, 60),
          likes: reply.metrics.likes
        })
      }

      // Melhor e pior
      if (!analysis.bestReply || (reply.metrics.likes || 0) > (analysis.bestReply.likes || 0)) {
        analysis.bestReply = {
          text: reply.replyText?.slice(0, 80),
          likes: reply.metrics.likes,
          length: reply.replyText?.length,
          author: reply.tweetAuthor,
          style: reply.style
        }
      }
      if (!analysis.worstReply || (reply.metrics.likes || 0) < (analysis.worstReply.likes || 0)) {
        analysis.worstReply = {
          text: reply.replyText?.slice(0, 80),
          likes: reply.metrics.likes,
          length: reply.replyText?.length,
          author: reply.tweetAuthor,
          style: reply.style
        }
      }
    }
  }

  // Cálculos finais
  analysis.avgLength = yesterdayReplies.length > 0
    ? Math.round(totalLength / yesterdayReplies.length)
    : 0

  analysis.questionRate = yesterdayReplies.length > 0
    ? ((analysis.questionsCount / yesterdayReplies.length) * 100).toFixed(1)
    : '0'

  analysis.authorReplyRate = analysis.withMetrics > 0
    ? ((analysis.totalAuthorReplies / analysis.withMetrics) * 100).toFixed(1)
    : '0'

  analysis.avgLikes = analysis.withMetrics > 0
    ? (analysis.totalLikes / analysis.withMetrics).toFixed(1)
    : '0'

  return analysis
}

/**
 * Compara com dias anteriores
 */
function compareWithHistory(todayAnalysis, reportHistory) {
  const history = reportHistory.reports || []
  if (history.length === 0) {
    return { hasHistory: false }
  }

  // Pega último relatório
  const lastReport = history[history.length - 1]
  const lastAnalysis = lastReport.analysis

  if (!lastAnalysis) {
    return { hasHistory: false }
  }

  const comparison = {
    hasHistory: true,
    lastDate: lastAnalysis.date,
    changes: {}
  }

  // Compara métricas principais
  const metrics = ['totalReplies', 'totalLikes', 'totalAuthorReplies', 'avgLength']
  for (const metric of metrics) {
    const today = todayAnalysis[metric] || 0
    const last = lastAnalysis[metric] || 0
    const diff = today - last
    const percentChange = last > 0 ? ((diff / last) * 100).toFixed(1) : 0

    comparison.changes[metric] = {
      today,
      last,
      diff,
      percentChange,
      improved: diff > 0
    }
  }

  // Compara author reply rate
  const todayRate = parseFloat(todayAnalysis.authorReplyRate) || 0
  const lastRate = parseFloat(lastAnalysis.authorReplyRate) || 0
  comparison.changes.authorReplyRate = {
    today: todayRate,
    last: lastRate,
    diff: (todayRate - lastRate).toFixed(1),
    improved: todayRate > lastRate
  }

  return comparison
}

// ============================================================
// GERAÇÃO DE INSIGHTS E APRENDIZADOS
// ============================================================

/**
 * Gera insights baseado na análise
 */
function generateInsights(analysis, comparison) {
  const insights = {
    successes: [],
    warnings: [],
    learnings: [],
    improvements: []
  }

  // === SUCESSOS ===

  // Author reply rate bom
  if (parseFloat(analysis.authorReplyRate) >= 15) {
    insights.successes.push({
      icon: '🎯',
      message: `Author reply rate de ${analysis.authorReplyRate}% - Excelente!`,
      detail: `${analysis.totalAuthorReplies} autores responderam`
    })
  }

  // Volume bom
  if (analysis.totalReplies >= 50) {
    insights.successes.push({
      icon: '📈',
      message: `${analysis.totalReplies} replies postados - Meta atingida!`
    })
  }

  // Melhorou vs dia anterior
  if (comparison.hasHistory) {
    if (comparison.changes.authorReplyRate?.improved) {
      insights.successes.push({
        icon: '⬆️',
        message: `Author reply rate melhorou: ${comparison.changes.authorReplyRate.last}% → ${comparison.changes.authorReplyRate.today}%`
      })
    }
    if (comparison.changes.totalLikes?.improved && comparison.changes.totalLikes.diff > 5) {
      insights.successes.push({
        icon: '❤️',
        message: `Likes aumentaram: +${comparison.changes.totalLikes.diff} vs ontem`
      })
    }
  }

  // === WARNINGS ===

  // Author reply rate baixo
  if (parseFloat(analysis.authorReplyRate) < 5 && analysis.withMetrics > 10) {
    insights.warnings.push({
      icon: '⚠️',
      message: `Author reply rate de apenas ${analysis.authorReplyRate}% - Muito baixo!`,
      action: 'Aumentar perguntas e reduzir tamanho dos replies'
    })
  }

  // Volume baixo
  if (analysis.totalReplies < 50) {
    insights.warnings.push({
      icon: '📉',
      message: `Apenas ${analysis.totalReplies} replies - Abaixo da meta de 50`,
      action: 'Verificar daemon ou reduzir intervalos'
    })
  }

  // Piorou vs dia anterior
  if (comparison.hasHistory) {
    if (!comparison.changes.authorReplyRate?.improved && parseFloat(comparison.changes.authorReplyRate?.diff) < -5) {
      insights.warnings.push({
        icon: '⬇️',
        message: `Author reply rate caiu: ${comparison.changes.authorReplyRate.last}% → ${comparison.changes.authorReplyRate.today}%`,
        action: 'Investigar mudanças na estratégia'
      })
    }
  }

  // Replies muito longos
  if (analysis.avgLength > 120) {
    insights.warnings.push({
      icon: '📏',
      message: `Tamanho médio de ${analysis.avgLength} chars - Muito longo!`,
      action: 'Reduzir maxChars no config'
    })
  }

  // Poucas perguntas
  if (parseFloat(analysis.questionRate) < 30) {
    insights.warnings.push({
      icon: '❓',
      message: `Apenas ${analysis.questionRate}% dos replies têm pergunta`,
      action: 'Aumentar questioning no prompt'
    })
  }

  // === LEARNINGS (o que o bot aprendeu) ===

  // Melhor fonte
  const sources = Object.entries(analysis.bySource)
    .filter(([_, data]) => data.count >= 3)
    .map(([source, data]) => ({
      source,
      ...data,
      authorReplyRate: data.count > 0 ? ((data.authorReplies / data.count) * 100).toFixed(1) : 0
    }))
    .sort((a, b) => parseFloat(b.authorReplyRate) - parseFloat(a.authorReplyRate))

  if (sources.length > 0) {
    const best = sources[0]
    const worst = sources[sources.length - 1]
    insights.learnings.push({
      icon: '📊',
      type: 'source',
      message: `Melhor fonte: "${best.source}" (${best.authorReplyRate}% author replies)`,
      data: best
    })
    if (sources.length > 1 && parseFloat(best.authorReplyRate) > parseFloat(worst.authorReplyRate) * 2) {
      insights.learnings.push({
        icon: '💡',
        type: 'source_gap',
        message: `"${best.source}" performa ${(parseFloat(best.authorReplyRate) / parseFloat(worst.authorReplyRate || 1)).toFixed(1)}x melhor que "${worst.source}"`,
        action: `Priorizar "${best.source}"`
      })
    }
  }

  // Melhor horário
  const hours = Object.entries(analysis.byHour)
    .filter(([_, data]) => data.count >= 2)
    .map(([hour, data]) => ({
      hour: parseInt(hour),
      ...data,
      authorReplyRate: data.count > 0 ? ((data.authorReplies / data.count) * 100).toFixed(1) : 0
    }))
    .sort((a, b) => parseFloat(b.authorReplyRate) - parseFloat(a.authorReplyRate))

  if (hours.length >= 3) {
    const topHours = hours.slice(0, 3).map(h => `${h.hour}h`)
    insights.learnings.push({
      icon: '⏰',
      type: 'timing',
      message: `Melhores horários: ${topHours.join(', ')}`,
      data: hours.slice(0, 3)
    })
  }

  // Melhor estilo
  const styles = Object.entries(analysis.byStyle)
    .filter(([_, data]) => data.count >= 3)
    .map(([style, data]) => ({
      style,
      ...data,
      authorReplyRate: data.count > 0 ? ((data.authorReplies / data.count) * 100).toFixed(1) : 0
    }))
    .sort((a, b) => parseFloat(b.authorReplyRate) - parseFloat(a.authorReplyRate))

  if (styles.length > 0) {
    const best = styles[0]
    insights.learnings.push({
      icon: '🎨',
      type: 'style',
      message: `Melhor estilo: "${best.style}" (${best.authorReplyRate}% author replies)`,
      data: best
    })
  }

  // Tamanho ideal
  const lengths = ['short', 'medium', 'long'].map(size => ({
    size,
    ...analysis.byLength[size],
    authorReplyRate: analysis.byLength[size].count > 0
      ? ((analysis.byLength[size].authorReplies / analysis.byLength[size].count) * 100).toFixed(1)
      : 0
  })).sort((a, b) => parseFloat(b.authorReplyRate) - parseFloat(a.authorReplyRate))

  if (lengths[0].count > 0) {
    const sizeLabels = { short: 'curtos (<80)', medium: 'médios (80-120)', long: 'longos (>120)' }
    insights.learnings.push({
      icon: '📐',
      type: 'length',
      message: `Replies ${sizeLabels[lengths[0].size]} performam melhor (${lengths[0].authorReplyRate}% author replies)`
    })
  }

  // === IMPROVEMENTS para amanhã ===

  // Se author reply rate baixo → mais perguntas
  if (parseFloat(analysis.authorReplyRate) < 10) {
    insights.improvements.push({
      priority: 'high',
      area: 'engagement',
      change: 'Aumentar questioning para 60%',
      reason: `Author reply rate de ${analysis.authorReplyRate}% está muito baixo`
    })
  }

  // Se replies longos → reduzir
  if (analysis.avgLength > 120) {
    insights.improvements.push({
      priority: 'high',
      area: 'length',
      change: 'Reduzir maxChars para 80',
      reason: `Tamanho médio de ${analysis.avgLength} chars é muito alto`
    })
  }

  // Se melhor fonte não é a mais usada → ajustar
  if (sources.length >= 2) {
    const best = sources[0]
    const mostUsed = [...sources].sort((a, b) => b.count - a.count)[0]
    if (best.source !== mostUsed.source && parseFloat(best.authorReplyRate) > parseFloat(mostUsed.authorReplyRate) * 1.5) {
      insights.improvements.push({
        priority: 'medium',
        area: 'source',
        change: `Priorizar fonte "${best.source}"`,
        reason: `Performa ${(parseFloat(best.authorReplyRate) / parseFloat(mostUsed.authorReplyRate || 1)).toFixed(1)}x melhor que a mais usada`
      })
    }
  }

  return insights
}

// ============================================================
// DECISÕES AUTOMÁTICAS
// ============================================================

/**
 * Decide se precisa reiniciar o daemon
 */
function shouldRestartDaemon(insights, strategy) {
  const reasons = []

  // Se tem mudanças de alta prioridade
  const highPriority = insights.improvements.filter(i => i.priority === 'high')
  if (highPriority.length > 0) {
    reasons.push(`${highPriority.length} melhorias de alta prioridade`)
  }

  // Se estratégia foi modificada recentemente
  if (strategy.lastUpdated) {
    const lastUpdate = new Date(strategy.lastUpdated).getTime()
    const now = Date.now()
    const hoursSinceUpdate = (now - lastUpdate) / (1000 * 60 * 60)
    if (hoursSinceUpdate < 1) {
      reasons.push('Estratégia modificada recentemente')
    }
  }

  return {
    should: reasons.length > 0,
    reasons
  }
}

/**
 * Aplica melhorias na estratégia
 */
function applyImprovements(strategy, improvements) {
  const applied = []

  for (const imp of improvements) {
    if (imp.priority !== 'high') continue

    if (imp.area === 'engagement' && imp.change.includes('questioning')) {
      const match = imp.change.match(/(\d+)/)
      if (match) {
        strategy.currentStrategy = strategy.currentStrategy || {}
        strategy.currentStrategy.toneBalance = strategy.currentStrategy.toneBalance || {}
        strategy.currentStrategy.toneBalance.questioning = parseInt(match[1])
        applied.push(`questioning: ${match[1]}%`)
      }
    }

    if (imp.area === 'length' && imp.change.includes('maxChars')) {
      const match = imp.change.match(/(\d+)/)
      if (match) {
        strategy.currentStrategy = strategy.currentStrategy || {}
        strategy.currentStrategy.maxChars = parseInt(match[1])
        applied.push(`maxChars: ${match[1]}`)
      }
    }
  }

  if (applied.length > 0) {
    strategy.lastUpdated = new Date().toISOString()
    strategy.adjustmentHistory = strategy.adjustmentHistory || []
    strategy.adjustmentHistory.push({
      date: new Date().toISOString(),
      changes: applied,
      reason: 'Auto-ajuste pelo daily-report'
    })
    strategy.adjustmentHistory = strategy.adjustmentHistory.slice(-50)
  }

  return { strategy, applied }
}

// ============================================================
// FORMATAÇÃO DO RELATÓRIO
// ============================================================

/**
 * Gera relatório formatado para console
 */
function formatConsoleReport(analysis, comparison, insights) {
  const lines = []
  const date = new Date()
  date.setDate(date.getDate() - 1)
  const dateStr = date.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })

  lines.push('')
  lines.push('╔' + '═'.repeat(68) + '╗')
  lines.push('║' + `${COLORS.bold}  📊 RELATÓRIO DIÁRIO DE APRENDIZADO ${COLORS.reset}`.padEnd(79) + '║')
  lines.push('║' + `  ${dateStr}`.padEnd(68) + '║')
  lines.push('╚' + '═'.repeat(68) + '╝')

  // === MÉTRICAS GERAIS ===
  lines.push(`\n${COLORS.cyan}━━━ MÉTRICAS DO DIA ━━━${COLORS.reset}`)
  lines.push(`  Replies postados: ${COLORS.bold}${analysis.totalReplies}${COLORS.reset}`)
  lines.push(`  Com métricas:     ${analysis.withMetrics}`)
  lines.push(`  Total likes:      ${analysis.totalLikes}`)
  lines.push(`  Author replies:   ${COLORS.bold}${analysis.totalAuthorReplies}${COLORS.reset} (${analysis.authorReplyRate}%)`)
  lines.push(`  Tamanho médio:    ${analysis.avgLength} chars`)
  lines.push(`  Com pergunta:     ${analysis.questionRate}%`)

  // === COMPARAÇÃO ===
  if (comparison.hasHistory) {
    lines.push(`\n${COLORS.cyan}━━━ VS DIA ANTERIOR (${comparison.lastDate}) ━━━${COLORS.reset}`)
    for (const [metric, change] of Object.entries(comparison.changes)) {
      if (metric === 'authorReplyRate') continue
      const arrow = change.improved ? '↑' : change.diff < 0 ? '↓' : '→'
      const color = change.improved ? COLORS.green : change.diff < 0 ? COLORS.red : COLORS.dim
      lines.push(`  ${metric}: ${change.last} → ${color}${change.today} (${arrow}${change.percentChange}%)${COLORS.reset}`)
    }
    const arChange = comparison.changes.authorReplyRate
    const arArrow = arChange.improved ? '↑' : arChange.diff < 0 ? '↓' : '→'
    const arColor = arChange.improved ? COLORS.green : arChange.diff < 0 ? COLORS.red : COLORS.dim
    lines.push(`  ${COLORS.bold}Author Reply Rate: ${arChange.last}% → ${arColor}${arChange.today}% (${arArrow}${arChange.diff}%)${COLORS.reset}`)
  }

  // === SUCESSOS ===
  if (insights.successes.length > 0) {
    lines.push(`\n${COLORS.green}━━━ O QUE FUNCIONOU ━━━${COLORS.reset}`)
    for (const s of insights.successes) {
      lines.push(`  ${s.icon} ${s.message}`)
      if (s.detail) lines.push(`     ${COLORS.dim}${s.detail}${COLORS.reset}`)
    }
  }

  // === WARNINGS ===
  if (insights.warnings.length > 0) {
    lines.push(`\n${COLORS.yellow}━━━ O QUE NÃO FUNCIONOU ━━━${COLORS.reset}`)
    for (const w of insights.warnings) {
      lines.push(`  ${w.icon} ${w.message}`)
      if (w.action) lines.push(`     → ${COLORS.bold}${w.action}${COLORS.reset}`)
    }
  }

  // === LEARNINGS ===
  if (insights.learnings.length > 0) {
    lines.push(`\n${COLORS.blue}━━━ O QUE EU APRENDI ━━━${COLORS.reset}`)
    for (const l of insights.learnings) {
      lines.push(`  ${l.icon} ${l.message}`)
      if (l.action) lines.push(`     → ${l.action}`)
    }
  }

  // === MELHORIAS ===
  if (insights.improvements.length > 0) {
    lines.push(`\n${COLORS.magenta}━━━ MELHORIAS PARA AMANHÃ ━━━${COLORS.reset}`)
    for (const i of insights.improvements) {
      const pColor = i.priority === 'high' ? COLORS.red : i.priority === 'medium' ? COLORS.yellow : COLORS.dim
      lines.push(`  ${pColor}[${i.priority.toUpperCase()}]${COLORS.reset} ${i.change}`)
      lines.push(`     ${COLORS.dim}Razão: ${i.reason}${COLORS.reset}`)
    }
  }

  // === MELHOR/PIOR REPLY ===
  if (analysis.bestReply) {
    lines.push(`\n${COLORS.cyan}━━━ DESTAQUE DO DIA ━━━${COLORS.reset}`)
    lines.push(`  ${COLORS.green}🏆 MELHOR:${COLORS.reset} "${analysis.bestReply.text}..."`)
    lines.push(`     ${analysis.bestReply.likes} likes | ${analysis.bestReply.length} chars | @${analysis.bestReply.author}`)
  }
  if (analysis.worstReply && analysis.worstReply.text !== analysis.bestReply?.text) {
    lines.push(`  ${COLORS.red}📉 PIOR:${COLORS.reset} "${analysis.worstReply.text}..."`)
    lines.push(`     ${analysis.worstReply.likes} likes | ${analysis.worstReply.length} chars`)
  }

  // === AUTORES QUE RESPONDERAM ===
  if (analysis.authorResponses.length > 0) {
    lines.push(`\n${COLORS.cyan}━━━ AUTORES QUE RESPONDERAM (75x BOOST!) ━━━${COLORS.reset}`)
    for (const ar of analysis.authorResponses.slice(0, 5)) {
      lines.push(`  🎯 @${ar.author}: "${ar.replyText}..."`)
    }
  }

  lines.push('\n' + '═'.repeat(70))

  return lines.join('\n')
}

/**
 * Gera relatório formatado para Telegram
 */
function formatTelegramReport(analysis, comparison, insights, applied, goalsSection = null) {
  const date = new Date()
  date.setDate(date.getDate() - 1)
  const dateStr = date.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  })

  let msg = `<b>📊 RELATÓRIO DIÁRIO - ${dateStr}</b>\n`

  // ==========================================
  // METAS DE MONETIZAÇÃO PRIMEIRO! (Prioridade #1)
  // ==========================================
  if (goalsSection?.telegram) {
    msg += goalsSection.telegram
    msg += '\n'
  }

  // Métricas operacionais
  msg += `<b>📈 Métricas do Dia:</b>\n`
  msg += `• Replies: ${analysis.totalReplies}\n`
  msg += `• Likes: ${analysis.totalLikes}\n`
  msg += `• Author replies: <b>${analysis.totalAuthorReplies}</b> (${analysis.authorReplyRate}%)\n`
  msg += `• Tamanho médio: ${analysis.avgLength} chars\n\n`

  // Comparação
  if (comparison.hasHistory) {
    msg += `<b>📊 vs Ontem:</b>\n`
    const arChange = comparison.changes.authorReplyRate
    const arEmoji = arChange.improved ? '↑' : arChange.diff < 0 ? '↓' : '→'
    msg += `• Author Rate: ${arChange.last}% ${arEmoji} ${arChange.today}%\n\n`
  }

  // O que funcionou
  if (insights.successes.length > 0) {
    msg += `<b>✅ Funcionou:</b>\n`
    for (const s of insights.successes.slice(0, 3)) {
      msg += `${s.icon} ${s.message}\n`
    }
    msg += '\n'
  }

  // O que não funcionou
  if (insights.warnings.length > 0) {
    msg += `<b>⚠️ Precisa melhorar:</b>\n`
    for (const w of insights.warnings.slice(0, 3)) {
      msg += `${w.icon} ${w.message}\n`
    }
    msg += '\n'
  }

  // Aprendizados
  if (insights.learnings.length > 0) {
    msg += `<b>💡 Aprendi:</b>\n`
    for (const l of insights.learnings.slice(0, 3)) {
      msg += `${l.icon} ${l.message}\n`
    }
    msg += '\n'
  }

  // Ajustes aplicados
  if (applied.length > 0) {
    msg += `<b>🔧 Ajustes aplicados:</b>\n`
    for (const a of applied) {
      msg += `• ${a}\n`
    }
    msg += '\n'
  }

  // Melhor reply
  if (analysis.bestReply) {
    msg += `<b>🏆 Melhor reply:</b>\n`
    msg += `"${analysis.bestReply.text}..."\n`
    msg += `${analysis.bestReply.likes} likes | @${analysis.bestReply.author}\n\n`
  }

  // Autores que responderam
  if (analysis.authorResponses.length > 0) {
    msg += `<b>🎯 Autores que responderam:</b>\n`
    for (const ar of analysis.authorResponses.slice(0, 3)) {
      msg += `• @${ar.author}\n`
    }
  }

  msg += `\n<i>🤖 Bot-X-Reply - Aprendizado Contínuo</i>`

  return msg
}

// ============================================================
// TELEGRAM
// ============================================================

async function sendTelegramReport(message) {
  const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID

  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log(`${COLORS.yellow}⚠️ Telegram não configurado${COLORS.reset}`)
    return false
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    })

    if (response.ok) {
      console.log(`${COLORS.green}✅ Relatório enviado no Telegram${COLORS.reset}`)
      return true
    } else {
      const error = await response.json()
      console.log(`${COLORS.red}❌ Erro Telegram: ${error.description}${COLORS.reset}`)
      return false
    }
  } catch (e) {
    console.log(`${COLORS.red}❌ Erro ao enviar Telegram: ${e.message}${COLORS.reset}`)
    return false
  }
}

// ============================================================
// DAEMON CONTROL
// ============================================================

function restartDaemon() {
  console.log(`\n${COLORS.yellow}🔄 Reiniciando daemon...${COLORS.reset}`)

  try {
    // Para daemon atual
    execSync('pkill -2 -f "auto-daemon.js" 2>/dev/null || true', { stdio: 'inherit' })

    // Aguarda
    execSync('sleep 3')

    // Inicia novo daemon em background
    execSync('nohup node scripts/auto-daemon.js >> logs/auto-daemon.log 2>&1 &', {
      cwd: path.join(__dirname, '..'),
      stdio: 'ignore',
      detached: true
    })

    console.log(`${COLORS.green}✅ Daemon reiniciado${COLORS.reset}`)
    return true
  } catch (e) {
    console.log(`${COLORS.red}❌ Erro ao reiniciar daemon: ${e.message}${COLORS.reset}`)
    return false
  }
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const force = args.includes('--force')

  console.log(`\n${COLORS.bold}🌙 Daily Report - Bot-X-Reply${COLORS.reset}\n`)

  // Verifica se já rodou hoje
  const reportHistory = loadJSON(REPORT_HISTORY_PATH, { reports: [], lastRun: null })
  const today = new Date().toISOString().split('T')[0]

  if (!force && reportHistory.lastRun === today) {
    console.log(`${COLORS.yellow}⚠️ Relatório já foi gerado hoje. Use --force para rodar novamente.${COLORS.reset}`)
    process.exit(0)
  }

  ensureDir(DATA_DIR)
  ensureDir(LOGS_DIR)

  // Carrega dados
  const knowledge = loadJSON(KNOWLEDGE_PATH, { replies: [] })
  let strategy = loadJSON(STRATEGY_PATH, { currentStrategy: {}, adjustmentHistory: [] })

  // ==========================================
  // METAS DE MONETIZAÇÃO (PRIORIDADE #1!)
  // ==========================================
  console.log('🎯 Analisando progresso das metas...')
  const goalsProgress = analyzeGoalsProgress()
  const goalsSection = formatGoalsSection(goalsProgress)

  // Mostra metas no console PRIMEIRO (é o mais importante!)
  console.log(goalsSection.console)

  // Analisa o dia anterior
  console.log('\n📊 Analisando replies de ontem...')
  const analysis = analyzeYesterdayReplies(knowledge)

  if (analysis.error) {
    console.log(`${COLORS.yellow}⚠️ ${analysis.error}${COLORS.reset}`)
    console.log(`   Data analisada: ${analysis.date}`)
    process.exit(0)
  }

  console.log(`   Encontrados ${analysis.totalReplies} replies`)

  // Compara com histórico
  const comparison = compareWithHistory(analysis, reportHistory)

  // Gera insights
  console.log('💡 Gerando insights...')
  const insights = generateInsights(analysis, comparison)

  // Aplica melhorias na estratégia
  let applied = []
  if (!dryRun) {
    const result = applyImprovements(strategy, insights.improvements)
    strategy = result.strategy
    applied = result.applied

    if (applied.length > 0) {
      saveJSON(STRATEGY_PATH, strategy)
      console.log(`${COLORS.green}✅ Estratégia atualizada: ${applied.join(', ')}${COLORS.reset}`)
    }
  }

  // Gera relatório console
  const consoleReport = formatConsoleReport(analysis, comparison, insights)
  console.log(consoleReport)

  // Salva no histórico
  if (!dryRun) {
    reportHistory.reports.push({
      date: analysis.date,
      timestamp: new Date().toISOString(),
      analysis,
      insights: {
        successes: insights.successes.length,
        warnings: insights.warnings.length,
        learnings: insights.learnings.length
      },
      applied
    })
    reportHistory.reports = reportHistory.reports.slice(-90) // 90 dias
    reportHistory.lastRun = today
    saveJSON(REPORT_HISTORY_PATH, reportHistory)
    console.log(`${COLORS.green}✅ Histórico salvo${COLORS.reset}`)
  }

  // ==========================================
  // VALIDAÇÃO DE HORÁRIOS (COMPROVAR COM DADOS!)
  // ==========================================
  let hoursValidation = null
  let hoursTelegramSection = ''

  try {
    console.log('\n⏰ Validando horários com dados REAIS...')
    const peakConfig = loadJSON(PEAK_HOURS_PATH, {})
    const { byHour, byDay, totalSamples } = analyzeHourPerformance(knowledge, 14)
    const rankedHours = rankHoursByPerformance(byHour)
    const rankedDays = rankDaysByPerformance(byDay)
    const discrepancies = compareWithConfig(rankedHours, rankedDays, peakConfig)

    hoursValidation = { rankedHours, rankedDays, discrepancies, totalSamples }

    // Mostra top horários no console
    if (rankedHours.length > 0) {
      console.log(`   Top horários REAIS: ${rankedHours.slice(0, 5).map(h => h.hour + 'h').join(', ')}`)
    }
    if (discrepancies.suggestions.length > 0) {
      console.log(`   ${COLORS.yellow}⚠️ ${discrepancies.suggestions.length} ajustes sugeridos!${COLORS.reset}`)
    }

    hoursTelegramSection = generateHoursTelegramSection(rankedHours, rankedDays, discrepancies)
  } catch (e) {
    console.log(`   ${COLORS.yellow}⚠️ Erro na validação de horários: ${e.message}${COLORS.reset}`)
  }

  // Envia Telegram
  if (!dryRun) {
    let telegramReport = formatTelegramReport(analysis, comparison, insights, applied, goalsSection)
    // Adiciona seção de validação de horários
    if (hoursTelegramSection) {
      telegramReport += hoursTelegramSection
    }
    await sendTelegramReport(telegramReport)
  }

  // ==========================================
  // AJUSTES AUTOMÁTICOS BASEADOS NAS METAS
  // ==========================================
  if (!dryRun && goalsProgress && !goalsProgress.error) {
    const goalAdjustments = generateGoalBasedAdjustments(goalsProgress, analysis)
    if (goalAdjustments.length > 0) {
      console.log(`\n${COLORS.magenta}🎯 Ajustes baseados nas METAS:${COLORS.reset}`)
      for (const adj of goalAdjustments) {
        console.log(`   ${adj.icon} ${adj.message}`)
        if (adj.action) console.log(`      → ${adj.action}`)
      }
    }
  }

  // Decide se reinicia daemon
  const restart = shouldRestartDaemon(insights, strategy)
  if (restart.should && !dryRun) {
    console.log(`\n${COLORS.yellow}🔄 Daemon precisa reiniciar: ${restart.reasons.join(', ')}${COLORS.reset}`)
    restartDaemon()
  }

  if (dryRun) {
    console.log(`\n${COLORS.yellow}⚠️ Modo dry-run: nada foi salvo ou enviado${COLORS.reset}`)
  }

  console.log(`\n${COLORS.bold}✅ Relatório completo!${COLORS.reset}\n`)
}

main().catch(e => {
  console.error(`${COLORS.red}Erro: ${e.message}${COLORS.reset}`)
  console.error(e.stack)
  process.exit(1)
})
