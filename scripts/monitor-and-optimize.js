#!/usr/bin/env node

/**
 * Monitor & Optimize - Sistema de Monitoramento e Auto-Otimização
 *
 * Executa análises periódicas e sugere/aplica otimizações:
 * 1. Analisa performance por fonte
 * 2. Identifica padrões de sucesso
 * 3. Sugere ajustes de configuração
 * 4. Envia relatórios via Telegram
 *
 * Uso:
 *   node scripts/monitor-and-optimize.js          # Análise completa
 *   node scripts/monitor-and-optimize.js --quick  # Análise rápida
 *   node scripts/monitor-and-optimize.js --apply  # Aplica otimizações automaticamente
 */

import 'dotenv/config'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import {
  loadKnowledge,
  saveKnowledge,
  getBestSources,
  getSourceStats,
  getKnowledgeSummary
} from '../src/knowledge.js'
import { getDailyStats } from '../src/finder.js'
import telegram from '../src/telegram.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Arquivo para salvar histórico de otimizações
const OPTIMIZATION_LOG = join(__dirname, '../data/optimization-log.json')

// Thresholds para otimização
const THRESHOLDS = {
  MIN_POSTS_FOR_ANALYSIS: 30,        // Mínimo de posts para analisar uma fonte
  MIN_POSTS_FOR_OPTIMIZATION: 100,   // Mínimo para aplicar otimizações automáticas
  HIGH_AUTHOR_REPLY_RATE: 0.25,      // 25% = fonte muito boa
  LOW_AUTHOR_REPLY_RATE: 0.05,       // 5% = fonte ruim
  HIGH_AVG_LIKES: 10,                // Média de likes considerada boa
  LOW_AVG_LIKES: 2                   // Média de likes considerada ruim
}

const COLORS = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
}

function log(color, symbol, msg) {
  console.log(`${COLORS[color]}${symbol} ${msg}${COLORS.reset}`)
}

function header(msg) {
  console.log(`\n${COLORS.bold}${COLORS.cyan}━━━ ${msg} ━━━${COLORS.reset}\n`)
}

/**
 * Carrega histórico de otimizações
 */
function loadOptimizationLog() {
  try {
    if (existsSync(OPTIMIZATION_LOG)) {
      return JSON.parse(readFileSync(OPTIMIZATION_LOG, 'utf-8'))
    }
  } catch (e) {}
  return { optimizations: [], lastAnalysis: null }
}

/**
 * Salva histórico de otimizações
 */
function saveOptimizationLog(log) {
  writeFileSync(OPTIMIZATION_LOG, JSON.stringify(log, null, 2))
}

/**
 * Analisa performance de cada fonte
 */
function analyzeSourcePerformance() {
  const stats = getSourceStats()
  const analysis = []

  for (const [source, data] of Object.entries(stats)) {
    if (data.posts < 5) continue // Ignora fontes com poucos dados

    const authorReplyRate = data.posts > 0 ? data.authorReplies / data.posts : 0
    const avgLikes = data.posts > 0 ? data.totalLikes / data.posts : 0
    const followRate = data.posts > 0 ? data.follows / data.posts : 0

    // Score composto (authorReplies tem peso 10x por causa do 75x boost)
    const performanceScore = (authorReplyRate * 100) + (avgLikes * 0.5) + (followRate * 20)

    let status = 'neutral'
    let recommendation = null

    if (data.posts >= THRESHOLDS.MIN_POSTS_FOR_ANALYSIS) {
      if (authorReplyRate >= THRESHOLDS.HIGH_AUTHOR_REPLY_RATE) {
        status = 'excellent'
        recommendation = `PRIORIZAR: ${(authorReplyRate * 100).toFixed(1)}% author reply rate!`
      } else if (authorReplyRate >= 0.15) {
        status = 'good'
        recommendation = 'Fonte funcionando bem'
      } else if (authorReplyRate <= THRESHOLDS.LOW_AUTHOR_REPLY_RATE && avgLikes <= THRESHOLDS.LOW_AVG_LIKES) {
        status = 'poor'
        recommendation = 'Considerar reduzir prioridade'
      }
    } else {
      recommendation = `Aguardando mais dados (${data.posts}/${THRESHOLDS.MIN_POSTS_FOR_ANALYSIS})`
    }

    analysis.push({
      source,
      posts: data.posts,
      authorReplies: data.authorReplies,
      authorReplyRate: Math.round(authorReplyRate * 1000) / 10, // Percentual com 1 decimal
      avgLikes: Math.round(avgLikes * 10) / 10,
      follows: data.follows,
      performanceScore: Math.round(performanceScore * 100) / 100,
      status,
      recommendation
    })
  }

  // Ordena por performance score
  analysis.sort((a, b) => b.performanceScore - a.performanceScore)

  return analysis
}

/**
 * Identifica padrões de sucesso
 */
function identifySuccessPatterns(knowledge) {
  const patterns = {
    bestTimeOfDay: null,
    bestDayOfWeek: null,
    bestReplyLength: null,
    bestTone: null,
    insights: []
  }

  const replies = knowledge.replies || []
  if (replies.length < 20) {
    patterns.insights.push('Dados insuficientes para identificar padrões (mín: 20 replies)')
    return patterns
  }

  // Analisa replies com métricas
  const repliesWithMetrics = replies.filter(r => r.metrics?.likes !== null)

  if (repliesWithMetrics.length < 10) {
    patterns.insights.push('Poucos replies com métricas de engajamento coletadas')
    return patterns
  }

  // Encontra padrões de sucesso
  const highEngagement = repliesWithMetrics.filter(r =>
    (r.metrics.likes || 0) + (r.metrics.replies || 0) * 2 > 5
  )

  if (highEngagement.length > 0) {
    // Analisa tamanho dos replies de sucesso
    const avgLength = highEngagement.reduce((sum, r) => sum + (r.replyText?.length || 0), 0) / highEngagement.length
    patterns.bestReplyLength = Math.round(avgLength)
    patterns.insights.push(`Replies de sucesso têm em média ${patterns.bestReplyLength} caracteres`)

    // Analisa tons
    const tones = {}
    highEngagement.forEach(r => {
      const tone = r.analysis?.tone || 'unknown'
      tones[tone] = (tones[tone] || 0) + 1
    })
    const bestTone = Object.entries(tones).sort((a, b) => b[1] - a[1])[0]
    if (bestTone) {
      patterns.bestTone = bestTone[0]
      patterns.insights.push(`Tom mais efetivo: "${patterns.bestTone}"`)
    }
  }

  return patterns
}

/**
 * Gera recomendações de otimização
 */
function generateOptimizations(sourceAnalysis, patterns) {
  const optimizations = []

  // Recomendações baseadas em fontes
  const excellentSources = sourceAnalysis.filter(s => s.status === 'excellent')
  const poorSources = sourceAnalysis.filter(s => s.status === 'poor')

  if (excellentSources.length > 0) {
    optimizations.push({
      type: 'priority_increase',
      target: excellentSources.map(s => s.source),
      reason: `Fontes com alto author reply rate (>25%)`,
      impact: 'high',
      action: 'Aumentar frequência de busca nestas fontes'
    })
  }

  if (poorSources.length > 0) {
    optimizations.push({
      type: 'priority_decrease',
      target: poorSources.map(s => s.source),
      reason: 'Baixo engajamento e poucos author replies',
      impact: 'medium',
      action: 'Reduzir frequência ou revisar filtros'
    })
  }

  // Recomendações baseadas em padrões
  if (patterns.bestReplyLength) {
    if (patterns.bestReplyLength < 80) {
      optimizations.push({
        type: 'reply_style',
        target: 'reply_length',
        reason: `Replies curtos (${patterns.bestReplyLength} chars) performam melhor`,
        impact: 'medium',
        action: 'Manter replies concisos'
      })
    } else if (patterns.bestReplyLength > 150) {
      optimizations.push({
        type: 'reply_style',
        target: 'reply_length',
        reason: `Replies mais longos (${patterns.bestReplyLength} chars) performam melhor`,
        impact: 'medium',
        action: 'Permitir replies mais elaborados'
      })
    }
  }

  return optimizations
}

/**
 * Aplica otimizações automaticamente
 */
async function applyOptimizations(optimizations) {
  const configPath = join(__dirname, '../config/accounts.json')
  let config = JSON.parse(readFileSync(configPath, 'utf-8'))
  let applied = []

  for (const opt of optimizations) {
    if (opt.type === 'priority_increase' && opt.impact === 'high') {
      // Registra no log mas não altera config automaticamente (muito arriscado)
      applied.push({
        ...opt,
        appliedAt: new Date().toISOString(),
        autoApplied: false,
        note: 'Recomendação registrada - aplicar manualmente se desejado'
      })
    }
  }

  return applied
}

/**
 * Gera relatório em texto
 */
function generateReport(sourceAnalysis, patterns, optimizations, dailyStats) {
  let report = ''

  report += '📊 RELATÓRIO DE PERFORMANCE\n'
  report += '═'.repeat(40) + '\n\n'

  // Estatísticas do dia
  report += '📅 HOJE:\n'
  report += `  Replies: ${dailyStats.repliesPosted}\n`
  report += `  Erros: ${dailyStats.errors}\n`
  report += `  Taxa sucesso: ${dailyStats.successRate}%\n\n`

  // Performance por fonte
  report += '🎯 PERFORMANCE POR FONTE:\n'
  sourceAnalysis.forEach((s, i) => {
    const emoji = s.status === 'excellent' ? '🌟' :
                  s.status === 'good' ? '✅' :
                  s.status === 'poor' ? '⚠️' : '📊'
    report += `${emoji} ${s.source}\n`
    report += `   Posts: ${s.posts} | AuthorReplies: ${s.authorReplies} (${s.authorReplyRate}%)\n`
    report += `   AvgLikes: ${s.avgLikes} | Score: ${s.performanceScore}\n`
    if (s.recommendation) {
      report += `   → ${s.recommendation}\n`
    }
    report += '\n'
  })

  // Padrões identificados
  if (patterns.insights.length > 0) {
    report += '💡 INSIGHTS:\n'
    patterns.insights.forEach(i => {
      report += `  • ${i}\n`
    })
    report += '\n'
  }

  // Otimizações recomendadas
  if (optimizations.length > 0) {
    report += '🔧 OTIMIZAÇÕES RECOMENDADAS:\n'
    optimizations.forEach(o => {
      report += `  [${o.impact.toUpperCase()}] ${o.action}\n`
      report += `    Motivo: ${o.reason}\n`
    })
  }

  return report
}

/**
 * Envia relatório via Telegram
 */
async function sendTelegramReport(report) {
  try {
    telegram.initBot({ polling: false })
    telegram.setChatId(process.env.TELEGRAM_CHAT_ID)

    // Divide em partes se muito longo
    const maxLength = 4000
    if (report.length > maxLength) {
      const parts = report.match(new RegExp(`.{1,${maxLength}}`, 'g'))
      for (const part of parts) {
        await telegram.sendMessage(`<pre>${part}</pre>`)
      }
    } else {
      await telegram.sendMessage(`<pre>${report}</pre>`)
    }

    return true
  } catch (e) {
    console.error('Erro ao enviar Telegram:', e.message)
    return false
  }
}

/**
 * Função principal
 */
async function main() {
  const args = process.argv.slice(2)
  const isQuick = args.includes('--quick')
  const shouldApply = args.includes('--apply')
  const shouldSendTelegram = args.includes('--telegram')

  console.log('\n' + '═'.repeat(60))
  console.log('  📈 MONITOR & OPTIMIZE - Sistema v2')
  console.log('  Análise de Performance e Auto-Otimização')
  console.log('═'.repeat(60))

  // 1. Carrega dados
  header('CARREGANDO DADOS')
  const knowledge = loadKnowledge()
  const dailyStats = getDailyStats()
  const summary = getKnowledgeSummary()

  console.log(`Total de replies registrados: ${summary.totalReplies}`)
  console.log(`Padrões aprendidos: ${summary.patternsLearned}`)
  console.log(`Última atualização: ${summary.lastUpdated || 'nunca'}`)

  // 2. Analisa performance por fonte
  header('ANÁLISE DE FONTES')
  const sourceAnalysis = analyzeSourcePerformance()

  if (sourceAnalysis.length === 0) {
    log('yellow', '⚠️', 'Nenhuma fonte com dados suficientes para análise')
    log('blue', 'ℹ️', 'Continue postando para coletar dados do Learning System')
  } else {
    sourceAnalysis.forEach(s => {
      const color = s.status === 'excellent' ? 'green' :
                    s.status === 'good' ? 'green' :
                    s.status === 'poor' ? 'red' : 'yellow'
      const symbol = s.status === 'excellent' ? '🌟' :
                     s.status === 'good' ? '✅' :
                     s.status === 'poor' ? '⚠️' : '📊'

      console.log(`\n${symbol} ${COLORS.bold}${s.source}${COLORS.reset}`)
      console.log(`   Posts: ${s.posts} | AuthorReplies: ${s.authorReplies} (${s.authorReplyRate}%)`)
      console.log(`   AvgLikes: ${s.avgLikes} | Follows: ${s.follows}`)
      console.log(`   Performance Score: ${COLORS[color]}${s.performanceScore}${COLORS.reset}`)
      if (s.recommendation) {
        console.log(`   ${COLORS.cyan}→ ${s.recommendation}${COLORS.reset}`)
      }
    })
  }

  // 3. Identifica padrões (se não for quick)
  let patterns = { insights: [] }
  if (!isQuick) {
    header('PADRÕES DE SUCESSO')
    patterns = identifySuccessPatterns(knowledge)

    if (patterns.insights.length > 0) {
      patterns.insights.forEach(i => log('blue', '💡', i))
    } else {
      log('yellow', '⚠️', 'Aguardando mais dados para identificar padrões')
    }
  }

  // 4. Gera otimizações
  header('OTIMIZAÇÕES RECOMENDADAS')
  const optimizations = generateOptimizations(sourceAnalysis, patterns)

  if (optimizations.length === 0) {
    log('green', '✅', 'Nenhuma otimização necessária no momento')
  } else {
    optimizations.forEach(o => {
      const color = o.impact === 'high' ? 'red' : o.impact === 'medium' ? 'yellow' : 'blue'
      console.log(`\n${COLORS[color]}[${o.impact.toUpperCase()}]${COLORS.reset} ${o.action}`)
      console.log(`   Motivo: ${o.reason}`)
      if (o.target) {
        console.log(`   Alvo: ${Array.isArray(o.target) ? o.target.join(', ') : o.target}`)
      }
    })
  }

  // 5. Aplica otimizações se solicitado
  if (shouldApply && optimizations.length > 0) {
    header('APLICANDO OTIMIZAÇÕES')
    const totalPosts = sourceAnalysis.reduce((sum, s) => sum + s.posts, 0)

    if (totalPosts < THRESHOLDS.MIN_POSTS_FOR_OPTIMIZATION) {
      log('yellow', '⚠️', `Aguardando ${THRESHOLDS.MIN_POSTS_FOR_OPTIMIZATION} posts para aplicar otimizações automáticas`)
      log('blue', 'ℹ️', `Atual: ${totalPosts} posts`)
    } else {
      const applied = await applyOptimizations(optimizations)
      if (applied.length > 0) {
        log('green', '✅', `${applied.length} otimizações registradas`)

        // Salva no log
        const optLog = loadOptimizationLog()
        optLog.optimizations.push(...applied)
        optLog.lastAnalysis = new Date().toISOString()
        saveOptimizationLog(optLog)
      }
    }
  }

  // 6. Envia relatório via Telegram se solicitado
  if (shouldSendTelegram) {
    header('ENVIANDO RELATÓRIO')
    const report = generateReport(sourceAnalysis, patterns, optimizations, dailyStats)
    const sent = await sendTelegramReport(report)
    if (sent) {
      log('green', '✅', 'Relatório enviado via Telegram')
    }
  }

  // 7. Resumo final
  console.log('\n' + '═'.repeat(60))
  console.log('  📋 RESUMO')
  console.log('═'.repeat(60))

  const totalPosts = sourceAnalysis.reduce((sum, s) => sum + s.posts, 0)
  const excellent = sourceAnalysis.filter(s => s.status === 'excellent').length
  const good = sourceAnalysis.filter(s => s.status === 'good').length
  const poor = sourceAnalysis.filter(s => s.status === 'poor').length

  console.log(`\n  Total de posts analisados: ${totalPosts}`)
  console.log(`  Fontes excelentes: ${excellent}`)
  console.log(`  Fontes boas: ${good}`)
  console.log(`  Fontes fracas: ${poor}`)
  console.log(`  Otimizações pendentes: ${optimizations.length}`)

  if (totalPosts < THRESHOLDS.MIN_POSTS_FOR_ANALYSIS) {
    console.log(`\n  ${COLORS.yellow}⏳ Aguardando mais dados (${totalPosts}/${THRESHOLDS.MIN_POSTS_FOR_ANALYSIS})${COLORS.reset}`)
  } else if (excellent > 0) {
    console.log(`\n  ${COLORS.green}🎯 Sistema aprendendo bem! Fontes de alta performance identificadas.${COLORS.reset}`)
  }

  console.log('\n' + '═'.repeat(60) + '\n')
}

main().catch(e => {
  console.error('Erro:', e)
  process.exit(1)
})
