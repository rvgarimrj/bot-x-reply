#!/usr/bin/env node

/**
 * Daily Optimizer - Análise e ajuste automático de estratégia
 *
 * Este script deve rodar 1x por dia (via crontab) para:
 * 1. Coletar métricas do dashboard
 * 2. Correlacionar com replies postados
 * 3. Ajustar estratégia automaticamente
 * 4. Enviar relatório no Telegram
 *
 * Uso:
 *   node scripts/daily-optimizer.js           # Análise completa
 *   node scripts/daily-optimizer.js --dry-run # Só mostra, não aplica
 */

import puppeteer from 'puppeteer-core'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const KNOWLEDGE_PATH = path.join(__dirname, '..', 'data', 'knowledge.json')
const STRATEGY_PATH = path.join(__dirname, '..', 'data', 'strategy-adjustments.json')
const DAILY_REPORT_PATH = path.join(__dirname, '..', 'data', 'daily-reports.json')

const COLORS = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
}

/**
 * Carrega knowledge.json
 */
function loadKnowledge() {
  try {
    return JSON.parse(fs.readFileSync(KNOWLEDGE_PATH, 'utf-8'))
  } catch {
    return { replies: [] }
  }
}

/**
 * Carrega estratégia
 */
function loadStrategy() {
  try {
    return JSON.parse(fs.readFileSync(STRATEGY_PATH, 'utf-8'))
  } catch {
    return {
      version: 1,
      currentStrategy: {
        maxChars: 100,
        toneBalance: { questioning: 50 }
      },
      adjustmentHistory: []
    }
  }
}

/**
 * Salva estratégia
 */
function saveStrategy(data) {
  fs.writeFileSync(STRATEGY_PATH, JSON.stringify(data, null, 2))
}

/**
 * Carrega relatórios diários
 */
function loadDailyReports() {
  try {
    return JSON.parse(fs.readFileSync(DAILY_REPORT_PATH, 'utf-8'))
  } catch {
    return { reports: [] }
  }
}

/**
 * Salva relatórios diários
 */
function saveDailyReports(data) {
  fs.writeFileSync(DAILY_REPORT_PATH, JSON.stringify(data, null, 2))
}

/**
 * Analisa métricas dos últimos 7 dias
 */
function analyzeWeek(knowledge) {
  const replies = knowledge.replies || []
  const now = Date.now()
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000
  const yesterdayStart = now - 24 * 60 * 60 * 1000

  const weekReplies = replies.filter(r => new Date(r.timestamp).getTime() > weekAgo)
  const todayReplies = replies.filter(r => new Date(r.timestamp).getTime() > yesterdayStart)

  // Métricas básicas
  const metrics = {
    totalReplies: weekReplies.length,
    todayReplies: todayReplies.length,
    withMetrics: weekReplies.filter(r => r.metrics?.likes !== null && r.metrics?.likes !== undefined).length,
    totalLikes: 0,
    totalAuthorReplies: 0,
    avgLength: 0,
    questionsAsked: 0
  }

  // Calcula agregados
  let totalLength = 0
  for (const reply of weekReplies) {
    totalLength += reply.replyText?.length || 0
    if (reply.replyText?.includes('?')) metrics.questionsAsked++
    if (reply.metrics?.likes) metrics.totalLikes += reply.metrics.likes
    if (reply.metrics?.authorReplied) metrics.totalAuthorReplies++
  }
  metrics.avgLength = weekReplies.length > 0 ? Math.round(totalLength / weekReplies.length) : 0

  // Taxa de author reply
  metrics.authorReplyRate = metrics.withMetrics > 0
    ? (metrics.totalAuthorReplies / metrics.withMetrics * 100).toFixed(1)
    : '0.0'

  // Taxa de perguntas
  metrics.questionRate = weekReplies.length > 0
    ? (metrics.questionsAsked / weekReplies.length * 100).toFixed(1)
    : '0.0'

  // Análise por tamanho
  const shortReplies = weekReplies.filter(r => (r.replyText?.length || 0) < 80)
  const longReplies = weekReplies.filter(r => (r.replyText?.length || 0) > 150)

  const shortWithMetrics = shortReplies.filter(r => r.metrics?.likes !== null)
  const longWithMetrics = longReplies.filter(r => r.metrics?.likes !== null)

  metrics.shortPerformance = {
    count: shortReplies.length,
    avgLikes: shortWithMetrics.length > 0
      ? (shortWithMetrics.reduce((s, r) => s + (r.metrics.likes || 0), 0) / shortWithMetrics.length).toFixed(1)
      : '0'
  }

  metrics.longPerformance = {
    count: longReplies.length,
    avgLikes: longWithMetrics.length > 0
      ? (longWithMetrics.reduce((s, r) => s + (r.metrics.likes || 0), 0) / longWithMetrics.length).toFixed(1)
      : '0'
  }

  // Melhor e pior reply da semana
  const withLikes = weekReplies.filter(r => r.metrics?.likes !== null)
  if (withLikes.length > 0) {
    withLikes.sort((a, b) => (b.metrics?.likes || 0) - (a.metrics?.likes || 0))
    metrics.bestReply = {
      text: withLikes[0].replyText?.slice(0, 80),
      likes: withLikes[0].metrics?.likes,
      length: withLikes[0].replyText?.length
    }
    metrics.worstReply = {
      text: withLikes[withLikes.length - 1].replyText?.slice(0, 80),
      likes: withLikes[withLikes.length - 1].metrics?.likes,
      length: withLikes[withLikes.length - 1].replyText?.length
    }
  }

  return metrics
}

/**
 * Gera recomendações baseadas na análise
 */
function generateRecommendations(metrics, currentStrategy) {
  const recommendations = []

  // Author reply rate baixo
  if (parseFloat(metrics.authorReplyRate) < 5 && metrics.withMetrics > 10) {
    recommendations.push({
      priority: 'critical',
      area: 'engagement',
      issue: `Author reply rate de apenas ${metrics.authorReplyRate}%`,
      action: 'Aumentar perguntas genuínas',
      change: { questioning: Math.min(60, (currentStrategy.toneBalance?.questioning || 30) + 10) }
    })
  }

  // Replies muito longos
  if (metrics.avgLength > 120) {
    recommendations.push({
      priority: 'high',
      area: 'length',
      issue: `Tamanho médio de ${metrics.avgLength} chars (ideal < 100)`,
      action: 'Reduzir maxChars',
      change: { maxChars: 80 }
    })
  }

  // Poucas perguntas
  if (parseFloat(metrics.questionRate) < 30 && metrics.totalReplies > 20) {
    recommendations.push({
      priority: 'high',
      area: 'style',
      issue: `Apenas ${metrics.questionRate}% dos replies têm pergunta`,
      action: 'Forçar mais perguntas no prompt',
      change: { mustAskQuestion: true }
    })
  }

  // Replies curtos performam melhor
  const shortAvg = parseFloat(metrics.shortPerformance.avgLikes)
  const longAvg = parseFloat(metrics.longPerformance.avgLikes)
  if (shortAvg > longAvg * 1.5 && metrics.shortPerformance.count > 5) {
    recommendations.push({
      priority: 'medium',
      area: 'validation',
      issue: `Replies curtos têm ${(shortAvg/longAvg).toFixed(1)}x mais likes`,
      action: 'Manter estratégia de replies curtos',
      change: null
    })
  }

  return recommendations
}

/**
 * Aplica mudanças na estratégia
 */
function applyChanges(strategy, recommendations) {
  const changes = []

  for (const rec of recommendations) {
    if (rec.change && rec.priority !== 'low') {
      if (rec.change.maxChars) {
        strategy.currentStrategy.maxChars = rec.change.maxChars
        changes.push(`maxChars: ${rec.change.maxChars}`)
      }
      if (rec.change.questioning) {
        strategy.currentStrategy.toneBalance = strategy.currentStrategy.toneBalance || {}
        strategy.currentStrategy.toneBalance.questioning = rec.change.questioning
        changes.push(`questioning: ${rec.change.questioning}%`)
      }
      if (rec.change.mustAskQuestion !== undefined) {
        strategy.currentStrategy.rules = strategy.currentStrategy.rules || {}
        strategy.currentStrategy.rules.mustAskQuestion = rec.change.mustAskQuestion
        changes.push(`mustAskQuestion: ${rec.change.mustAskQuestion}`)
      }
    }
  }

  if (changes.length > 0) {
    strategy.lastUpdated = new Date().toISOString()
    strategy.adjustmentHistory.push({
      date: new Date().toISOString(),
      changes,
      reason: 'Ajuste automático pelo daily-optimizer'
    })
    // Mantém últimos 30 ajustes
    strategy.adjustmentHistory = strategy.adjustmentHistory.slice(-30)
  }

  return { strategy, changes }
}

/**
 * Gera relatório formatado
 */
function generateReport(metrics, recommendations, changes) {
  const lines = []

  lines.push('═'.repeat(50))
  lines.push('📊 RELATÓRIO DIÁRIO - Bot-X-Reply')
  lines.push(`📅 ${new Date().toLocaleDateString('pt-BR')}`)
  lines.push('═'.repeat(50))

  lines.push('')
  lines.push('📈 MÉTRICAS DA SEMANA:')
  lines.push(`  • Replies: ${metrics.totalReplies} (hoje: ${metrics.todayReplies})`)
  lines.push(`  • Likes total: ${metrics.totalLikes}`)
  lines.push(`  • Author replies: ${metrics.totalAuthorReplies} (${metrics.authorReplyRate}%)`)
  lines.push(`  • Com pergunta: ${metrics.questionRate}%`)
  lines.push(`  • Tamanho médio: ${metrics.avgLength} chars`)

  if (metrics.bestReply) {
    lines.push('')
    lines.push('🏆 MELHOR REPLY:')
    lines.push(`  "${metrics.bestReply.text}..."`)
    lines.push(`  ${metrics.bestReply.likes} likes | ${metrics.bestReply.length} chars`)
  }

  if (metrics.shortPerformance.count > 0) {
    lines.push('')
    lines.push('📏 PERFORMANCE POR TAMANHO:')
    lines.push(`  • Curtos (<80): ${metrics.shortPerformance.count} replies, ${metrics.shortPerformance.avgLikes} avg likes`)
    lines.push(`  • Longos (>150): ${metrics.longPerformance.count} replies, ${metrics.longPerformance.avgLikes} avg likes`)
  }

  if (recommendations.length > 0) {
    lines.push('')
    lines.push('⚠️ RECOMENDAÇÕES:')
    for (const rec of recommendations) {
      const icon = rec.priority === 'critical' ? '🔴' : rec.priority === 'high' ? '🟡' : '🟢'
      lines.push(`  ${icon} ${rec.issue}`)
      lines.push(`     → ${rec.action}`)
    }
  }

  if (changes.length > 0) {
    lines.push('')
    lines.push('🔧 AJUSTES APLICADOS:')
    for (const change of changes) {
      lines.push(`  • ${change}`)
    }
  }

  lines.push('')
  lines.push('═'.repeat(50))

  return lines.join('\n')
}

/**
 * Envia relatório via Telegram
 */
async function sendTelegramReport(report) {
  const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID

  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log(`${COLORS.yellow}⚠️ Telegram não configurado, pulando envio${COLORS.reset}`)
    return
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: report,
        parse_mode: 'HTML'
      })
    })

    if (response.ok) {
      console.log(`${COLORS.green}✅ Relatório enviado no Telegram${COLORS.reset}`)
    }
  } catch (e) {
    console.error(`${COLORS.red}Erro ao enviar Telegram: ${e.message}${COLORS.reset}`)
  }
}

/**
 * Função principal
 */
async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')

  console.log(`\n${COLORS.bold}🔄 Daily Optimizer - Bot-X-Reply${COLORS.reset}\n`)

  // Carrega dados
  const knowledge = loadKnowledge()
  let strategy = loadStrategy()
  const dailyReports = loadDailyReports()

  // Analisa métricas
  console.log('📊 Analisando métricas da semana...')
  const metrics = analyzeWeek(knowledge)

  // Gera recomendações
  console.log('💡 Gerando recomendações...')
  const recommendations = generateRecommendations(metrics, strategy.currentStrategy)

  // Aplica mudanças (se não for dry-run)
  let changes = []
  if (!dryRun && recommendations.some(r => r.priority === 'critical' || r.priority === 'high')) {
    console.log('🔧 Aplicando ajustes...')
    const result = applyChanges(strategy, recommendations)
    strategy = result.strategy
    changes = result.changes
    saveStrategy(strategy)
  }

  // Gera relatório
  const report = generateReport(metrics, recommendations, changes)

  // Mostra no console
  console.log('\n' + report)

  // Salva no histórico
  dailyReports.reports.push({
    date: new Date().toISOString(),
    metrics,
    recommendations,
    changesApplied: changes
  })
  dailyReports.reports = dailyReports.reports.slice(-30) // Últimos 30 dias
  saveDailyReports(dailyReports)

  // Envia no Telegram (se não for dry-run)
  if (!dryRun) {
    await sendTelegramReport(report)
  }

  if (dryRun) {
    console.log(`\n${COLORS.yellow}⚠️ Modo dry-run: nenhuma mudança foi aplicada${COLORS.reset}`)
  }

  if (changes.length > 0) {
    console.log(`\n${COLORS.bold}⚠️ Reinicie o daemon para aplicar: pkill -2 -f auto-daemon && node scripts/auto-daemon.js${COLORS.reset}`)
  }
}

main().catch(e => {
  console.error(`${COLORS.red}Erro: ${e.message}${COLORS.reset}`)
  process.exit(1)
})
