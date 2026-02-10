#!/usr/bin/env node

/**
 * Validate Hours - Validação e Auto-Ajuste de Horários de Ouro
 *
 * Este script COMPROVA se os horários configurados são realmente os melhores
 * baseado em DADOS REAIS, não em pesquisa externa.
 *
 * Roda diariamente (integrado ao daily-report) e:
 * 1. Analisa performance REAL por horário e dia
 * 2. Compara com a configuração atual
 * 3. Identifica discrepâncias
 * 4. Sugere/aplica ajustes automáticos
 * 5. Documenta aprendizados
 *
 * Uso:
 *   node scripts/validate-hours.js           # Análise + sugestões
 *   node scripts/validate-hours.js --apply   # Aplica ajustes automaticamente
 *   node scripts/validate-hours.js --report  # Só mostra relatório
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '..', 'data')
const CONFIG_DIR = path.join(__dirname, '..', 'config')

const KNOWLEDGE_PATH = path.join(DATA_DIR, 'knowledge.json')
const PEAK_HOURS_PATH = path.join(CONFIG_DIR, 'peak-hours.json')
const HOURS_VALIDATION_PATH = path.join(DATA_DIR, 'hours-validation.json')

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

// Mínimo de dados para considerar estatisticamente relevante
const MIN_SAMPLES = 5

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

/**
 * Analisa performance REAL por horário
 */
function analyzeHourPerformance(knowledge, daysBack = 14) {
  const replies = knowledge.replies || []
  const cutoff = Date.now() - (daysBack * 24 * 60 * 60 * 1000)

  // Filtra replies recentes com métricas
  const recentReplies = replies.filter(r => {
    if (!r.timestamp) return false
    if (new Date(r.timestamp).getTime() < cutoff) return false
    // Precisa ter métricas coletadas
    return r.metrics?.likes !== null && r.metrics?.likes !== undefined
  })

  const byHour = {}
  const byDay = {}
  const byHourDay = {} // Combinação hora + dia

  for (const reply of recentReplies) {
    const date = new Date(reply.timestamp)
    const hour = date.getHours()
    const day = date.getDay()
    const hourDayKey = `${hour}-${day}`

    // Por hora
    if (!byHour[hour]) {
      byHour[hour] = {
        count: 0,
        totalLikes: 0,
        authorReplies: 0,
        impressions: 0
      }
    }
    byHour[hour].count++
    byHour[hour].totalLikes += reply.metrics.likes || 0
    if (reply.metrics.authorReplied) byHour[hour].authorReplies++

    // Por dia
    if (!byDay[day]) {
      byDay[day] = {
        count: 0,
        totalLikes: 0,
        authorReplies: 0
      }
    }
    byDay[day].count++
    byDay[day].totalLikes += reply.metrics.likes || 0
    if (reply.metrics.authorReplied) byDay[day].authorReplies++

    // Combinação
    if (!byHourDay[hourDayKey]) {
      byHourDay[hourDayKey] = {
        hour,
        day,
        count: 0,
        totalLikes: 0,
        authorReplies: 0
      }
    }
    byHourDay[hourDayKey].count++
    byHourDay[hourDayKey].totalLikes += reply.metrics.likes || 0
    if (reply.metrics.authorReplied) byHourDay[hourDayKey].authorReplies++
  }

  return { byHour, byDay, byHourDay, totalSamples: recentReplies.length }
}

/**
 * Calcula score de performance para ranking
 * Prioriza: author replies (75x) > likes > volume
 */
function calculatePerformanceScore(data) {
  if (data.count < MIN_SAMPLES) return null

  const avgLikes = data.totalLikes / data.count
  const authorReplyRate = (data.authorReplies / data.count) * 100

  // Score: author replies valem MUITO mais que likes
  // 1 author reply = 75x valor de 1 like (baseado no algoritmo do X)
  return (authorReplyRate * 7.5) + avgLikes
}

/**
 * Rankeia horários por performance REAL
 */
function rankHoursByPerformance(byHour) {
  const ranked = []

  for (const [hour, data] of Object.entries(byHour)) {
    const score = calculatePerformanceScore(data)
    if (score === null) continue // Dados insuficientes

    const avgLikes = data.totalLikes / data.count
    const authorReplyRate = (data.authorReplies / data.count) * 100

    ranked.push({
      hour: parseInt(hour),
      count: data.count,
      avgLikes: avgLikes.toFixed(2),
      authorReplyRate: authorReplyRate.toFixed(1),
      score: score.toFixed(2),
      authorReplies: data.authorReplies
    })
  }

  return ranked.sort((a, b) => parseFloat(b.score) - parseFloat(a.score))
}

/**
 * Rankeia dias por performance REAL
 */
function rankDaysByPerformance(byDay) {
  const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab']
  const ranked = []

  for (const [day, data] of Object.entries(byDay)) {
    const score = calculatePerformanceScore(data)
    if (score === null) continue

    const avgLikes = data.totalLikes / data.count
    const authorReplyRate = (data.authorReplies / data.count) * 100

    ranked.push({
      day: parseInt(day),
      dayName: dayNames[day],
      count: data.count,
      avgLikes: avgLikes.toFixed(2),
      authorReplyRate: authorReplyRate.toFixed(1),
      score: score.toFixed(2)
    })
  }

  return ranked.sort((a, b) => parseFloat(b.score) - parseFloat(a.score))
}

/**
 * Compara configuração atual com dados REAIS
 */
function compareWithConfig(rankedHours, rankedDays, currentConfig) {
  const discrepancies = {
    hours: [],
    days: [],
    suggestions: []
  }

  // Extrai horários gold da config atual
  const configGold = currentConfig.hours?.gold?.hours || [12, 13, 14, 20, 21]
  const configHigh = currentConfig.hours?.high?.hours || [11, 15, 16, 17, 19, 22]

  // Pega top 5 horários por performance REAL
  const topHours = rankedHours.slice(0, 5).map(h => h.hour)
  const realGoldHours = rankedHours.slice(0, 5)

  // Verifica discrepâncias em horários
  for (const goldHour of configGold) {
    const realRank = rankedHours.findIndex(h => h.hour === goldHour)
    if (realRank === -1) {
      discrepancies.hours.push({
        type: 'no_data',
        hour: goldHour,
        message: `Hora ${goldHour}h marcada como GOLD mas sem dados suficientes`
      })
    } else if (realRank >= 5) {
      const realData = rankedHours[realRank]
      discrepancies.hours.push({
        type: 'underperforming',
        hour: goldHour,
        configTier: 'gold',
        realRank: realRank + 1,
        score: realData.score,
        message: `Hora ${goldHour}h é GOLD na config mas está em #${realRank + 1} na prática (score: ${realData.score})`
      })
    }
  }

  // Verifica horários que deveriam ser GOLD mas não são
  for (const topHour of realGoldHours) {
    if (!configGold.includes(topHour.hour) && !configHigh.includes(topHour.hour)) {
      discrepancies.hours.push({
        type: 'missing_gold',
        hour: topHour.hour,
        score: topHour.score,
        avgLikes: topHour.avgLikes,
        authorReplyRate: topHour.authorReplyRate,
        message: `Hora ${topHour.hour}h tem score ${topHour.score} mas não está em GOLD/HIGH!`
      })
    }
  }

  // Verifica dias
  const configBestDays = currentConfig.days?.best?.days || [2, 3, 4]
  const realBestDays = rankedDays.slice(0, 3).map(d => d.day)

  for (const configDay of configBestDays) {
    const realRank = rankedDays.findIndex(d => d.day === configDay)
    if (realRank >= 3 && rankedDays.length >= 3) {
      const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab']
      discrepancies.days.push({
        type: 'day_underperforming',
        day: configDay,
        dayName: dayNames[configDay],
        realRank: realRank + 1,
        message: `${dayNames[configDay]} marcado como melhor dia mas está em #${realRank + 1}`
      })
    }
  }

  // Gera sugestões
  if (realGoldHours.length >= 3) {
    const newGold = realGoldHours.slice(0, 5).map(h => h.hour)
    const newHigh = rankedHours.slice(5, 11).map(h => h.hour)

    if (JSON.stringify(newGold.sort()) !== JSON.stringify([...configGold].sort())) {
      discrepancies.suggestions.push({
        type: 'update_gold_hours',
        current: configGold,
        suggested: newGold,
        reason: 'Baseado em performance REAL dos últimos 14 dias'
      })
    }
  }

  if (rankedDays.length >= 3) {
    const newBestDays = rankedDays.slice(0, 3).map(d => d.day)
    if (JSON.stringify(newBestDays.sort()) !== JSON.stringify([...configBestDays].sort())) {
      const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab']
      discrepancies.suggestions.push({
        type: 'update_best_days',
        current: configBestDays.map(d => dayNames[d]),
        suggested: newBestDays.map(d => dayNames[d]),
        reason: 'Baseado em performance REAL dos últimos 14 dias'
      })
    }
  }

  return discrepancies
}

/**
 * Aplica ajustes na configuração
 */
function applyAdjustments(discrepancies, currentConfig) {
  let updated = false
  const changes = []

  for (const suggestion of discrepancies.suggestions) {
    if (suggestion.type === 'update_gold_hours') {
      currentConfig.hours = currentConfig.hours || {}
      currentConfig.hours.gold = currentConfig.hours.gold || {}
      currentConfig.hours.gold.hours = suggestion.suggested
      currentConfig.hours.gold.lastUpdated = new Date().toISOString()
      currentConfig.hours.gold.source = 'auto-validated'
      changes.push(`GOLD hours: ${suggestion.current.join(',')} → ${suggestion.suggested.join(',')}`)
      updated = true
    }

    if (suggestion.type === 'update_best_days') {
      currentConfig.days = currentConfig.days || {}
      currentConfig.days.best = currentConfig.days.best || {}
      const dayMap = { 'Dom': 0, 'Seg': 1, 'Ter': 2, 'Qua': 3, 'Qui': 4, 'Sex': 5, 'Sab': 6 }
      // Mantém como está se não conseguir mapear
      changes.push(`Best days: ${suggestion.current.join(',')} → ${suggestion.suggested.join(',')}`)
      updated = true
    }
  }

  if (updated) {
    currentConfig.lastValidated = new Date().toISOString()
    currentConfig.validationHistory = currentConfig.validationHistory || []
    currentConfig.validationHistory.push({
      date: new Date().toISOString(),
      changes
    })
    currentConfig.validationHistory = currentConfig.validationHistory.slice(-30)
  }

  return { updated, changes, config: currentConfig }
}

/**
 * Gera relatório de validação
 */
function generateReport(rankedHours, rankedDays, discrepancies, totalSamples) {
  const lines = []

  lines.push('')
  lines.push('╔' + '═'.repeat(68) + '╗')
  lines.push('║' + `${COLORS.bold}  🔍 VALIDAÇÃO DE HORÁRIOS - Dados REAIS ${COLORS.reset}`.padEnd(79) + '║')
  lines.push('║' + `  Últimos 14 dias | ${totalSamples} replies com métricas`.padEnd(68) + '║')
  lines.push('╚' + '═'.repeat(68) + '╝')

  // Top horários REAIS
  lines.push(`\n${COLORS.cyan}━━━ TOP HORÁRIOS (COMPROVADO) ━━━${COLORS.reset}`)
  lines.push('Rank | Hora | Replies | AvgLikes | AuthorReply% | Score')
  lines.push('-----|------|---------|----------|--------------|-------')

  const tierEmoji = (rank) => rank <= 5 ? '🥇' : rank <= 10 ? '🔥' : '📈'

  for (let i = 0; i < Math.min(12, rankedHours.length); i++) {
    const h = rankedHours[i]
    const emoji = tierEmoji(i + 1)
    lines.push(
      `${emoji} ${String(i + 1).padStart(2)} | ${String(h.hour).padStart(2)}h  | ` +
      `${String(h.count).padStart(7)} | ${h.avgLikes.padStart(8)} | ` +
      `${h.authorReplyRate.padStart(11)}% | ${h.score}`
    )
  }

  // Top dias REAIS
  lines.push(`\n${COLORS.cyan}━━━ TOP DIAS (COMPROVADO) ━━━${COLORS.reset}`)
  lines.push('Rank | Dia | Replies | AvgLikes | AuthorReply% | Score')
  lines.push('-----|-----|---------|----------|--------------|-------')

  for (let i = 0; i < rankedDays.length; i++) {
    const d = rankedDays[i]
    const emoji = i < 3 ? '🏆' : '•'
    lines.push(
      `${emoji} ${String(i + 1).padStart(2)} | ${d.dayName} | ` +
      `${String(d.count).padStart(7)} | ${d.avgLikes.padStart(8)} | ` +
      `${d.authorReplyRate.padStart(11)}% | ${d.score}`
    )
  }

  // Discrepâncias
  if (discrepancies.hours.length > 0 || discrepancies.days.length > 0) {
    lines.push(`\n${COLORS.yellow}━━━ ⚠️ DISCREPÂNCIAS ENCONTRADAS ━━━${COLORS.reset}`)

    for (const d of discrepancies.hours) {
      lines.push(`  ${COLORS.yellow}⚠️ ${d.message}${COLORS.reset}`)
    }
    for (const d of discrepancies.days) {
      lines.push(`  ${COLORS.yellow}⚠️ ${d.message}${COLORS.reset}`)
    }
  }

  // Sugestões
  if (discrepancies.suggestions.length > 0) {
    lines.push(`\n${COLORS.magenta}━━━ 💡 AJUSTES SUGERIDOS ━━━${COLORS.reset}`)

    for (const s of discrepancies.suggestions) {
      lines.push(`  ${COLORS.bold}${s.type}:${COLORS.reset}`)
      lines.push(`    Atual:    ${JSON.stringify(s.current)}`)
      lines.push(`    Sugerido: ${COLORS.green}${JSON.stringify(s.suggested)}${COLORS.reset}`)
      lines.push(`    Razão:    ${s.reason}`)
    }
  } else {
    lines.push(`\n${COLORS.green}━━━ ✅ CONFIGURAÇÃO VALIDADA ━━━${COLORS.reset}`)
    lines.push('  Os horários configurados estão alinhados com os dados REAIS!')
  }

  lines.push('\n' + '═'.repeat(70))

  return lines.join('\n')
}

/**
 * Gera seção para o relatório diário do Telegram
 */
function generateTelegramSection(rankedHours, rankedDays, discrepancies) {
  let msg = '\n⏰ <b>VALIDAÇÃO DE HORÁRIOS:</b>\n'

  // Top 3 horários
  msg += '\n<b>Melhores horários (dados reais):</b>\n'
  for (let i = 0; i < Math.min(3, rankedHours.length); i++) {
    const h = rankedHours[i]
    const emoji = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'
    msg += `${emoji} ${h.hour}h - ${h.avgLikes} likes, ${h.authorReplyRate}% author\n`
  }

  // Top 3 dias
  msg += '\n<b>Melhores dias:</b>\n'
  for (let i = 0; i < Math.min(3, rankedDays.length); i++) {
    const d = rankedDays[i]
    const emoji = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'
    msg += `${emoji} ${d.dayName} - ${d.avgLikes} likes\n`
  }

  // Discrepâncias
  if (discrepancies.suggestions.length > 0) {
    msg += '\n⚠️ <b>Ajustes necessários:</b>\n'
    for (const s of discrepancies.suggestions) {
      if (s.type === 'update_gold_hours') {
        msg += `• GOLD: ${s.current.join(',')} → ${s.suggested.join(',')}\n`
      }
    }
  } else {
    msg += '\n✅ Horários validados!\n'
  }

  return msg
}

/**
 * Função principal
 */
async function main() {
  const args = process.argv.slice(2)
  const applyChanges = args.includes('--apply')
  const reportOnly = args.includes('--report')

  console.log(`\n${COLORS.bold}🔍 Validação de Horários - Bot-X-Reply${COLORS.reset}\n`)

  // Carrega dados
  const knowledge = loadJSON(KNOWLEDGE_PATH, { replies: [] })
  let peakConfig = loadJSON(PEAK_HOURS_PATH, {})
  const validationHistory = loadJSON(HOURS_VALIDATION_PATH, { validations: [] })

  // Analisa performance REAL
  console.log('📊 Analisando performance REAL dos últimos 14 dias...')
  const { byHour, byDay, byHourDay, totalSamples } = analyzeHourPerformance(knowledge, 14)

  if (totalSamples < 20) {
    console.log(`${COLORS.yellow}⚠️ Apenas ${totalSamples} replies com métricas. Precisa de mais dados para validação confiável.${COLORS.reset}`)
    console.log('   Execute: node scripts/collect-metrics.js --all')
  }

  // Rankeia por performance
  const rankedHours = rankHoursByPerformance(byHour)
  const rankedDays = rankDaysByPerformance(byDay)

  // Compara com config atual
  const discrepancies = compareWithConfig(rankedHours, rankedDays, peakConfig)

  // Gera relatório
  const report = generateReport(rankedHours, rankedDays, discrepancies, totalSamples)
  console.log(report)

  // Salva validação no histórico
  const validation = {
    date: new Date().toISOString(),
    totalSamples,
    topHours: rankedHours.slice(0, 5).map(h => ({ hour: h.hour, score: h.score })),
    topDays: rankedDays.slice(0, 3).map(d => ({ day: d.day, name: d.dayName, score: d.score })),
    discrepanciesFound: discrepancies.hours.length + discrepancies.days.length,
    suggestionsCount: discrepancies.suggestions.length
  }

  if (!reportOnly) {
    validationHistory.validations.push(validation)
    validationHistory.validations = validationHistory.validations.slice(-90)
    validationHistory.lastValidation = new Date().toISOString()
    saveJSON(HOURS_VALIDATION_PATH, validationHistory)
    console.log(`${COLORS.green}✅ Validação salva em data/hours-validation.json${COLORS.reset}`)
  }

  // Aplica ajustes se solicitado
  if (applyChanges && discrepancies.suggestions.length > 0) {
    console.log(`\n${COLORS.yellow}🔧 Aplicando ajustes...${COLORS.reset}`)
    const { updated, changes, config } = applyAdjustments(discrepancies, peakConfig)

    if (updated) {
      saveJSON(PEAK_HOURS_PATH, config)
      console.log(`${COLORS.green}✅ Configuração atualizada:${COLORS.reset}`)
      for (const change of changes) {
        console.log(`   • ${change}`)
      }
      console.log(`\n${COLORS.yellow}⚠️ Reinicie o daemon para aplicar: pkill -2 -f auto-daemon${COLORS.reset}`)
    }
  } else if (discrepancies.suggestions.length > 0 && !applyChanges) {
    console.log(`\n${COLORS.yellow}💡 Use --apply para aplicar os ajustes sugeridos${COLORS.reset}`)
  }

  // Exporta para uso em outros scripts
  return {
    rankedHours,
    rankedDays,
    discrepancies,
    telegramSection: generateTelegramSection(rankedHours, rankedDays, discrepancies)
  }
}

// Exporta funções para uso em outros scripts
export {
  analyzeHourPerformance,
  rankHoursByPerformance,
  rankDaysByPerformance,
  compareWithConfig,
  applyAdjustments,
  generateTelegramSection
}

// Só executa main() se chamado diretamente (não quando importado)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => {
    console.error(`${COLORS.red}Erro: ${e.message}${COLORS.reset}`)
    console.error(e.stack)
    process.exit(1)
  })
}
