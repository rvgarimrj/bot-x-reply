#!/usr/bin/env node

/**
 * Analyze and Learn - Sistema de Aprendizado Contínuo
 *
 * Este script analisa todos os dados e gera insights que são:
 * 1. Salvos em data/learnings.json (persistência)
 * 2. Exibidos como relatório (para compartilhar com Claude)
 *
 * Uso:
 *   node scripts/analyze-and-learn.js           # Análise completa
 *   node scripts/analyze-and-learn.js --quick   # Análise rápida
 *   node scripts/analyze-and-learn.js --report  # Só mostra relatório
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { loadKnowledge, getBestSources, getSourceStats } from '../src/knowledge.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LEARNINGS_PATH = path.join(__dirname, '..', 'data', 'learnings.json')

const COLORS = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
}

function loadLearnings() {
  try {
    return JSON.parse(fs.readFileSync(LEARNINGS_PATH, 'utf-8'))
  } catch {
    return {
      version: 1,
      lastAnalysis: null,
      insights: [],
      patterns: { bestSources: [], bestHours: [], bestStyles: [], keywordsPerformance: {} },
      experiments: [],
      recommendations: [],
      changelog: []
    }
  }
}

function saveLearnings(data) {
  fs.writeFileSync(LEARNINGS_PATH, JSON.stringify(data, null, 2))
}

/**
 * Análise de performance por fonte
 */
function analyzeSourcePerformance(knowledge) {
  const stats = knowledge.sourceStats || {}
  const analysis = []

  for (const [source, data] of Object.entries(stats)) {
    if (data.posts < 3) continue // Precisa de amostra mínima

    const authorReplyRate = data.posts > 0 ? (data.authorReplies / data.posts * 100) : 0
    const avgLikes = data.posts > 0 ? (data.totalLikes / data.posts) : 0

    // Score de performance (authorReplies vale mais que likes)
    const performanceScore = (authorReplyRate * 3) + avgLikes

    analysis.push({
      source,
      posts: data.posts,
      authorReplyRate: authorReplyRate.toFixed(1),
      avgLikes: avgLikes.toFixed(1),
      performanceScore: performanceScore.toFixed(1),
      status: authorReplyRate > 20 ? 'excellent' : authorReplyRate > 10 ? 'good' : authorReplyRate > 5 ? 'average' : 'poor'
    })
  }

  return analysis.sort((a, b) => parseFloat(b.performanceScore) - parseFloat(a.performanceScore))
}

/**
 * Análise de horários de melhor performance
 */
function analyzeHourPerformance(knowledge) {
  const replies = knowledge.replies || []
  const hourStats = {}

  for (const reply of replies) {
    if (!reply.metrics?.likes && reply.metrics?.likes !== 0) continue

    const hour = new Date(reply.timestamp).getHours()
    if (!hourStats[hour]) {
      hourStats[hour] = { posts: 0, totalLikes: 0, authorReplies: 0 }
    }

    hourStats[hour].posts++
    hourStats[hour].totalLikes += reply.metrics.likes || 0
    if (reply.metrics.authorReplied) hourStats[hour].authorReplies++
  }

  const analysis = []
  for (const [hour, data] of Object.entries(hourStats)) {
    if (data.posts < 3) continue

    const avgLikes = data.totalLikes / data.posts
    const authorReplyRate = (data.authorReplies / data.posts * 100)

    analysis.push({
      hour: parseInt(hour),
      posts: data.posts,
      avgLikes: avgLikes.toFixed(1),
      authorReplyRate: authorReplyRate.toFixed(1)
    })
  }

  return analysis.sort((a, b) => {
    const arDiff = parseFloat(b.authorReplyRate) - parseFloat(a.authorReplyRate)
    if (arDiff !== 0) return arDiff
    return parseFloat(b.avgLikes) - parseFloat(a.avgLikes)
  })
}

/**
 * Análise de estilos de reply
 */
function analyzeStylePerformance(knowledge) {
  const replies = knowledge.replies || []
  const styleStats = {}

  for (const reply of replies) {
    const style = reply.style || 'unknown'
    if (!reply.metrics?.likes && reply.metrics?.likes !== 0) continue

    if (!styleStats[style]) {
      styleStats[style] = { posts: 0, totalLikes: 0, authorReplies: 0 }
    }

    styleStats[style].posts++
    styleStats[style].totalLikes += reply.metrics.likes || 0
    if (reply.metrics.authorReplied) styleStats[style].authorReplies++
  }

  const analysis = []
  for (const [style, data] of Object.entries(styleStats)) {
    if (data.posts < 3) continue

    analysis.push({
      style,
      posts: data.posts,
      avgLikes: (data.totalLikes / data.posts).toFixed(1),
      authorReplyRate: (data.authorReplies / data.posts * 100).toFixed(1)
    })
  }

  return analysis.sort((a, b) => {
    const arDiff = parseFloat(b.authorReplyRate) - parseFloat(a.authorReplyRate)
    if (arDiff !== 0) return arDiff
    return parseFloat(b.avgLikes) - parseFloat(a.avgLikes)
  })
}

/**
 * Gera insights automaticamente
 */
function generateInsights(sourceAnalysis, hourAnalysis, styleAnalysis, knowledge) {
  const insights = []
  const now = new Date().toISOString()

  // Insight: Melhor fonte
  if (sourceAnalysis.length > 0) {
    const best = sourceAnalysis[0]
    if (parseFloat(best.authorReplyRate) > 15) {
      insights.push({
        type: 'success',
        category: 'source',
        message: `Fonte "${best.source}" está performando muito bem: ${best.authorReplyRate}% de author replies`,
        action: 'Priorizar esta fonte',
        date: now
      })
    }

    const worst = sourceAnalysis[sourceAnalysis.length - 1]
    if (sourceAnalysis.length > 1 && parseFloat(worst.authorReplyRate) < 5 && worst.posts > 10) {
      insights.push({
        type: 'warning',
        category: 'source',
        message: `Fonte "${worst.source}" tem baixa performance: apenas ${worst.authorReplyRate}% de author replies`,
        action: 'Considerar reduzir prioridade ou desativar',
        date: now
      })
    }
  }

  // Insight: Melhores horários
  if (hourAnalysis.length >= 3) {
    const topHours = hourAnalysis.slice(0, 3).map(h => h.hour + 'h')
    insights.push({
      type: 'info',
      category: 'timing',
      message: `Melhores horários para engajamento: ${topHours.join(', ')}`,
      action: 'Concentrar replies nesses horários',
      date: now
    })
  }

  // Insight: Volume de dados
  const totalPosts = (knowledge.replies || []).length
  const postsWithMetrics = (knowledge.replies || []).filter(r => r.metrics?.likes !== null && r.metrics?.likes !== undefined).length

  if (postsWithMetrics < 30) {
    insights.push({
      type: 'info',
      category: 'data',
      message: `Apenas ${postsWithMetrics} replies com métricas coletadas de ${totalPosts} total`,
      action: 'Rodar "node scripts/collect-metrics.js --all" para coletar mais dados',
      date: now
    })
  }

  // Insight: Author reply rate geral
  const totalAuthorReplies = (knowledge.replies || []).filter(r => r.metrics?.authorReplied).length
  if (postsWithMetrics > 20) {
    const overallRate = (totalAuthorReplies / postsWithMetrics * 100).toFixed(1)
    if (parseFloat(overallRate) > 20) {
      insights.push({
        type: 'success',
        category: 'engagement',
        message: `Taxa geral de author replies: ${overallRate}% - Excelente!`,
        action: 'Manter estratégia atual',
        date: now
      })
    } else if (parseFloat(overallRate) < 10) {
      insights.push({
        type: 'warning',
        category: 'engagement',
        message: `Taxa geral de author replies: ${overallRate}% - Abaixo do ideal`,
        action: 'Focar em tweets de autores mais engajados',
        date: now
      })
    }
  }

  return insights
}

/**
 * Gera recomendações de otimização
 */
function generateRecommendations(sourceAnalysis, hourAnalysis, learnings) {
  const recommendations = []
  const now = new Date().toISOString()

  // Recomendação: Ajustar fontes
  if (sourceAnalysis.length >= 2) {
    const best = sourceAnalysis[0]
    const worst = sourceAnalysis[sourceAnalysis.length - 1]

    if (parseFloat(best.performanceScore) > parseFloat(worst.performanceScore) * 2) {
      recommendations.push({
        priority: 'high',
        category: 'config',
        title: 'Redistribuir prioridade de fontes',
        description: `"${best.source}" performa ${(parseFloat(best.performanceScore) / parseFloat(worst.performanceScore)).toFixed(1)}x melhor que "${worst.source}"`,
        action: `Aumentar prioridade de "${best.source}" no config`,
        date: now
      })
    }
  }

  // Recomendação: Coletar métricas
  const lastCollect = learnings.changelog.find(c => c.action === 'collect_metrics')
  if (!lastCollect || (Date.now() - new Date(lastCollect.date).getTime()) > 24 * 60 * 60 * 1000) {
    recommendations.push({
      priority: 'medium',
      category: 'data',
      title: 'Coletar métricas de engajamento',
      description: 'Métricas não coletadas nas últimas 24h',
      action: 'Executar: node scripts/collect-metrics.js',
      date: now
    })
  }

  return recommendations
}

/**
 * Imprime relatório formatado
 */
function printReport(sourceAnalysis, hourAnalysis, styleAnalysis, insights, recommendations, knowledge) {
  const totalReplies = (knowledge.replies || []).length
  const repliesWithMetrics = (knowledge.replies || []).filter(r => r.metrics?.likes !== null).length

  console.log('\n' + '═'.repeat(70))
  console.log(`${COLORS.bold}  📊 RELATÓRIO DE APRENDIZADO - Bot-X-Reply${COLORS.reset}`)
  console.log(`  Gerado em: ${new Date().toLocaleString('pt-BR')}`)
  console.log('═'.repeat(70))

  // Overview
  console.log(`\n${COLORS.cyan}━━━ OVERVIEW ━━━${COLORS.reset}`)
  console.log(`  Total de replies: ${totalReplies}`)
  console.log(`  Com métricas coletadas: ${repliesWithMetrics}`)
  console.log(`  Fontes rastreadas: ${Object.keys(knowledge.sourceStats || {}).length}`)

  // Performance por fonte
  console.log(`\n${COLORS.cyan}━━━ PERFORMANCE POR FONTE ━━━${COLORS.reset}`)
  if (sourceAnalysis.length === 0) {
    console.log(`  ${COLORS.yellow}Dados insuficientes (precisa de mais posts)${COLORS.reset}`)
  } else {
    console.log('  Fonte                      | Posts | AuthorReply% | AvgLikes | Status')
    console.log('  ' + '─'.repeat(65))
    for (const src of sourceAnalysis) {
      const statusColor = src.status === 'excellent' ? COLORS.green :
                         src.status === 'good' ? COLORS.blue :
                         src.status === 'average' ? COLORS.yellow : COLORS.red
      const name = src.source.padEnd(25)
      console.log(`  ${name} | ${String(src.posts).padStart(5)} | ${src.authorReplyRate.padStart(11)}% | ${src.avgLikes.padStart(8)} | ${statusColor}${src.status}${COLORS.reset}`)
    }
  }

  // Melhores horários
  console.log(`\n${COLORS.cyan}━━━ MELHORES HORÁRIOS ━━━${COLORS.reset}`)
  if (hourAnalysis.length === 0) {
    console.log(`  ${COLORS.yellow}Dados insuficientes (precisa coletar métricas)${COLORS.reset}`)
  } else {
    const top5 = hourAnalysis.slice(0, 5)
    console.log('  Horário | Posts | AuthorReply% | AvgLikes')
    console.log('  ' + '─'.repeat(45))
    for (const h of top5) {
      console.log(`  ${String(h.hour).padStart(2)}:00    | ${String(h.posts).padStart(5)} | ${h.authorReplyRate.padStart(11)}% | ${h.avgLikes.padStart(8)}`)
    }
  }

  // Insights
  console.log(`\n${COLORS.cyan}━━━ INSIGHTS AUTOMÁTICOS ━━━${COLORS.reset}`)
  if (insights.length === 0) {
    console.log(`  ${COLORS.yellow}Nenhum insight ainda (precisa de mais dados)${COLORS.reset}`)
  } else {
    for (const insight of insights) {
      const icon = insight.type === 'success' ? '✅' : insight.type === 'warning' ? '⚠️' : 'ℹ️'
      const color = insight.type === 'success' ? COLORS.green : insight.type === 'warning' ? COLORS.yellow : COLORS.blue
      console.log(`  ${icon} ${color}${insight.message}${COLORS.reset}`)
      console.log(`     └─ Ação: ${insight.action}`)
    }
  }

  // Recomendações
  console.log(`\n${COLORS.cyan}━━━ RECOMENDAÇÕES ━━━${COLORS.reset}`)
  if (recommendations.length === 0) {
    console.log(`  ${COLORS.green}✅ Nenhuma otimização urgente necessária${COLORS.reset}`)
  } else {
    for (const rec of recommendations) {
      const priorityColor = rec.priority === 'high' ? COLORS.red : rec.priority === 'medium' ? COLORS.yellow : COLORS.blue
      console.log(`  ${priorityColor}[${rec.priority.toUpperCase()}]${COLORS.reset} ${rec.title}`)
      console.log(`     ${rec.description}`)
      console.log(`     └─ ${rec.action}`)
    }
  }

  // Comandos úteis
  console.log(`\n${COLORS.cyan}━━━ PRÓXIMOS PASSOS ━━━${COLORS.reset}`)
  console.log('  1. Coletar métricas: node scripts/collect-metrics.js')
  console.log('  2. Verificar sistema: node scripts/check-success.js')
  console.log('  3. Re-analisar:       node scripts/analyze-and-learn.js')

  console.log('\n' + '═'.repeat(70))
  console.log(`  ${COLORS.bold}💡 Compartilhe este relatório comigo (Claude) para continuar melhorando!${COLORS.reset}`)
  console.log('═'.repeat(70) + '\n')
}

/**
 * Função principal
 */
async function main() {
  const args = process.argv.slice(2)
  const quickMode = args.includes('--quick')
  const reportOnly = args.includes('--report')

  console.log(`\n${COLORS.bold}🔍 Analisando dados...${COLORS.reset}\n`)

  // Carrega dados
  const knowledge = loadKnowledge()
  const learnings = loadLearnings()

  // Análises
  const sourceAnalysis = analyzeSourcePerformance(knowledge)
  const hourAnalysis = analyzeHourPerformance(knowledge)
  const styleAnalysis = analyzeStylePerformance(knowledge)

  // Gera insights e recomendações
  const insights = generateInsights(sourceAnalysis, hourAnalysis, styleAnalysis, knowledge)
  const recommendations = generateRecommendations(sourceAnalysis, hourAnalysis, learnings)

  // Atualiza learnings
  if (!reportOnly) {
    learnings.lastAnalysis = new Date().toISOString()
    learnings.patterns.bestSources = sourceAnalysis.slice(0, 3).map(s => s.source)
    learnings.patterns.bestHours = hourAnalysis.slice(0, 5).map(h => h.hour)

    // Adiciona novos insights (evita duplicatas)
    for (const insight of insights) {
      const exists = learnings.insights.some(i =>
        i.message === insight.message &&
        (Date.now() - new Date(i.date).getTime()) < 7 * 24 * 60 * 60 * 1000
      )
      if (!exists) {
        learnings.insights.push(insight)
      }
    }

    // Mantém apenas últimos 50 insights
    learnings.insights = learnings.insights.slice(-50)

    // Atualiza recomendações
    learnings.recommendations = recommendations

    // Registra no changelog
    learnings.changelog.push({
      action: 'analysis',
      date: new Date().toISOString(),
      summary: `Analisados ${knowledge.replies?.length || 0} replies, ${sourceAnalysis.length} fontes`
    })
    learnings.changelog = learnings.changelog.slice(-100)

    saveLearnings(learnings)
    console.log(`${COLORS.green}✅ Learnings salvos em data/learnings.json${COLORS.reset}`)
  }

  // Imprime relatório
  printReport(sourceAnalysis, hourAnalysis, styleAnalysis, insights, recommendations, knowledge)
}

main().catch(e => {
  console.error('Erro:', e)
  process.exit(1)
})
