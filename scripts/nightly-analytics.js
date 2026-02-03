#!/usr/bin/env node

/**
 * Nightly Analytics - Coleta e compara métricas do X às 23:59
 *
 * Este script:
 * 1. Acessa https://x.com/i/account_analytics
 * 2. Coleta métricas do dia
 * 3. Compara com dia anterior
 * 4. Identifica o que funcionou e o que precisa ajustar
 * 5. Gera recomendações para o dia seguinte
 * 6. Envia relatório no Telegram
 *
 * Uso:
 *   node scripts/nightly-analytics.js           # Coleta e analisa
 *   node scripts/nightly-analytics.js --dry-run # Só mostra, não salva
 */

import puppeteer from 'puppeteer-core'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ANALYTICS_PATH = path.join(__dirname, '..', 'data', 'nightly-analytics.json')
const STRATEGY_PATH = path.join(__dirname, '..', 'data', 'strategy-adjustments.json')

const COLORS = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
}

// Metas de crescimento (baseadas nas imagens do usuário)
const GOALS = {
  // Para monetização no X
  premiumFollowers: 500,        // Meta: 500 Premium followers
  verifiedFollowers: 2000,      // Meta: 2000 verified followers
  impressions3Months: 5000000,  // Meta: 5M impressões em 3 meses

  // Métricas diárias ideais
  dailyImpressions: 50000,      // ~1.6M/mês para atingir 5M em 3 meses
  dailyEngagementRate: 5,       // 5% é considerado bom
  dailyProfileVisits: 100,
  dailyFollowerGain: 10         // ~300/mês
}

/**
 * Conecta ao Chrome existente
 */
async function connectToChrome() {
  try {
    const response = await fetch('http://127.0.0.1:9222/json/version')
    const data = await response.json()

    const browser = await puppeteer.connect({
      browserWSEndpoint: data.webSocketDebuggerUrl,
      protocolTimeout: 120000
    })

    return browser
  } catch (e) {
    console.error(`${COLORS.red}Erro: Chrome não está rodando na porta 9222${COLORS.reset}`)
    process.exit(1)
  }
}

/**
 * Coleta métricas do X Analytics
 */
async function collectAnalytics(browser) {
  console.log(`\n${COLORS.cyan}📊 Coletando métricas do X Analytics...${COLORS.reset}\n`)

  const page = await browser.newPage()

  try {
    await page.setDefaultTimeout(60000)

    // Navega para analytics
    await page.goto('https://x.com/i/account_analytics', {
      waitUntil: 'networkidle2',
      timeout: 45000
    })

    // Aguarda carregar
    await new Promise(r => setTimeout(r, 8000))

    // Extrai métricas
    const metrics = await page.evaluate(() => {
      const data = {
        date: new Date().toISOString().split('T')[0],
        timestamp: new Date().toISOString(),
        raw: {},
        parsed: {}
      }

      const extractNumber = (text) => {
        if (!text) return null
        const clean = text.replace(/[^\d.KMkm]/g, '').trim()
        if (!clean) return null
        if (clean.toLowerCase().includes('k')) return parseFloat(clean) * 1000
        if (clean.toLowerCase().includes('m')) return parseFloat(clean) * 1000000
        return parseFloat(clean) || null
      }

      const extractPercentage = (text) => {
        if (!text) return null
        const match = text.match(/([+-]?\d+(?:\.\d+)?)\s*%/)
        return match ? parseFloat(match[1]) : null
      }

      // Captura todo o texto visível
      const bodyText = document.body.innerText
      data.raw.bodyText = bodyText.slice(0, 5000) // Primeiros 5000 chars para debug

      // Tenta encontrar métricas específicas
      // Padrões comuns no X Analytics
      const patterns = [
        { key: 'followers', regex: /(\d+(?:,\d+)*(?:\.\d+)?[KMkm]?)\s*(?:Seguidores|Followers)/i },
        { key: 'impressions', regex: /(?:Impressões|Impressions)[:\s]*(\d+(?:,\d+)*(?:\.\d+)?[KMkm]?)/i },
        { key: 'engagements', regex: /(?:Engajamentos|Engagements)[:\s]*(\d+(?:,\d+)*(?:\.\d+)?[KMkm]?)/i },
        { key: 'engagementRate', regex: /(?:Taxa de engajamento|Engagement rate)[:\s]*(\d+(?:\.\d+)?%?)/i },
        { key: 'profileVisits', regex: /(?:Visitas ao perfil|Profile visits)[:\s]*(\d+(?:,\d+)*(?:\.\d+)?[KMkm]?)/i },
        { key: 'mentions', regex: /(?:Menções|Mentions)[:\s]*(\d+(?:,\d+)*(?:\.\d+)?[KMkm]?)/i },
        { key: 'newFollowers', regex: /(?:Novos seguidores|New followers)[:\s]*(\d+(?:,\d+)*(?:\.\d+)?[KMkm]?)/i }
      ]

      for (const { key, regex } of patterns) {
        const match = bodyText.match(regex)
        if (match) {
          data.raw[key] = match[1] || match[0]
          data.parsed[key] = extractNumber(match[1])
        }
      }

      // Tenta capturar mudanças percentuais
      const changePatterns = [
        { key: 'followersChange', regex: /(?:Seguidores|Followers)[\s\S]{0,100}?([+-]?\d+(?:\.\d+)?%)/i },
        { key: 'impressionsChange', regex: /(?:Impressões|Impressions)[\s\S]{0,100}?([+-]?\d+(?:\.\d+)?%)/i },
        { key: 'engagementsChange', regex: /(?:Engajamentos|Engagements)[\s\S]{0,100}?([+-]?\d+(?:\.\d+)?%)/i }
      ]

      for (const { key, regex } of changePatterns) {
        const match = bodyText.match(regex)
        if (match) {
          data.raw[key] = match[1]
          data.parsed[key] = extractPercentage(match[1])
        }
      }

      return data
    })

    // Screenshot para análise manual
    const screenshotPath = path.join(__dirname, '..', 'data', 'analytics-screenshot.png')
    await page.screenshot({ path: screenshotPath, fullPage: true })
    console.log(`📸 Screenshot: data/analytics-screenshot.png`)

    await page.close()
    return metrics

  } catch (e) {
    console.error(`${COLORS.red}Erro ao coletar: ${e.message}${COLORS.reset}`)
    await page.close().catch(() => {})
    return null
  }
}

/**
 * Carrega histórico de analytics
 */
function loadAnalyticsHistory() {
  try {
    return JSON.parse(fs.readFileSync(ANALYTICS_PATH, 'utf-8'))
  } catch {
    return {
      version: 1,
      entries: [],
      dailyComparisons: []
    }
  }
}

/**
 * Salva histórico
 */
function saveAnalyticsHistory(data) {
  fs.writeFileSync(ANALYTICS_PATH, JSON.stringify(data, null, 2))
}

/**
 * Carrega estratégia
 */
function loadStrategy() {
  try {
    return JSON.parse(fs.readFileSync(STRATEGY_PATH, 'utf-8'))
  } catch {
    return { currentStrategy: {}, adjustmentHistory: [] }
  }
}

/**
 * Salva estratégia
 */
function saveStrategy(data) {
  fs.writeFileSync(STRATEGY_PATH, JSON.stringify(data, null, 2))
}

/**
 * Compara hoje com ontem
 */
function compareWithYesterday(today, history) {
  const entries = history.entries || []
  if (entries.length === 0) {
    return { hasYesterday: false }
  }

  // Encontra entrada de ontem
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = yesterday.toISOString().split('T')[0]

  const yesterdayEntry = entries.find(e => e.date === yesterdayStr)
  if (!yesterdayEntry) {
    return { hasYesterday: false, message: 'Sem dados de ontem para comparar' }
  }

  const comparison = {
    hasYesterday: true,
    yesterday: yesterdayEntry.parsed,
    today: today.parsed,
    changes: {}
  }

  // Calcula mudanças
  const metrics = ['followers', 'impressions', 'engagements', 'profileVisits', 'newFollowers']
  for (const metric of metrics) {
    const todayVal = today.parsed?.[metric]
    const yesterdayVal = yesterdayEntry.parsed?.[metric]

    if (todayVal !== null && yesterdayVal !== null) {
      const diff = todayVal - yesterdayVal
      const percentChange = yesterdayVal > 0 ? ((diff / yesterdayVal) * 100) : 0

      comparison.changes[metric] = {
        yesterday: yesterdayVal,
        today: todayVal,
        diff,
        percentChange: percentChange.toFixed(1)
      }
    }
  }

  return comparison
}

/**
 * Analisa progresso em direção às metas
 */
function analyzeProgress(today, comparison) {
  const analysis = {
    status: 'on_track', // on_track, behind, ahead
    insights: [],
    recommendations: [],
    urgentActions: []
  }

  const parsed = today.parsed || {}

  // Verifica progresso de seguidores
  if (parsed.followers) {
    const daysTo500Premium = Math.ceil((GOALS.premiumFollowers - parsed.followers) / GOALS.dailyFollowerGain)
    const daysTo2000Verified = Math.ceil((GOALS.verifiedFollowers - parsed.followers) / GOALS.dailyFollowerGain)

    if (parsed.followers < GOALS.premiumFollowers) {
      analysis.insights.push({
        type: 'progress',
        metric: 'followers',
        current: parsed.followers,
        goal: GOALS.premiumFollowers,
        message: `${parsed.followers}/${GOALS.premiumFollowers} Premium followers (~${daysTo500Premium} dias para meta)`
      })
    }
  }

  // Verifica impressões diárias
  if (parsed.impressions) {
    const ratio = parsed.impressions / GOALS.dailyImpressions
    if (ratio < 0.5) {
      analysis.status = 'behind'
      analysis.urgentActions.push({
        priority: 'high',
        action: 'Aumentar volume de replies para melhorar impressões',
        reason: `Impressões (${parsed.impressions}) estão ${(ratio * 100).toFixed(0)}% da meta diária`
      })
    } else if (ratio > 1.5) {
      analysis.insights.push({
        type: 'success',
        message: `Impressões excelentes: ${parsed.impressions} (${(ratio * 100).toFixed(0)}% da meta)`
      })
    }
  }

  // Analisa mudanças vs ontem
  if (comparison.hasYesterday) {
    for (const [metric, change] of Object.entries(comparison.changes)) {
      if (change.diff < 0 && metric !== 'newFollowers') {
        analysis.insights.push({
          type: 'warning',
          metric,
          message: `${metric} caiu ${Math.abs(change.percentChange)}% vs ontem`
        })
      }

      if (change.diff > 0 && parseFloat(change.percentChange) > 20) {
        analysis.insights.push({
          type: 'success',
          metric,
          message: `${metric} subiu ${change.percentChange}% vs ontem!`
        })
      }
    }

    // Se seguidores caíram, algo está errado
    if (comparison.changes.followers?.diff < 0) {
      analysis.status = 'behind'
      analysis.urgentActions.push({
        priority: 'critical',
        action: 'Revisar qualidade dos replies - seguidores CAINDO',
        reason: `Perdemos ${Math.abs(comparison.changes.followers.diff)} seguidores`
      })
    }
  }

  // Recomendações baseadas na análise
  if (analysis.status === 'behind') {
    analysis.recommendations.push({
      priority: 'high',
      area: 'engagement',
      action: 'Focar em perguntas que geram author replies (75x boost)',
      expected: 'Aumentar visibilidade via algoritmo'
    })

    analysis.recommendations.push({
      priority: 'high',
      area: 'targeting',
      action: 'Priorizar contas com alta audiência (>100k followers)',
      expected: 'Maximizar impressões por reply'
    })
  }

  if (!comparison.hasYesterday || comparison.changes.engagements?.diff < 0) {
    analysis.recommendations.push({
      priority: 'medium',
      area: 'style',
      action: 'Reduzir tamanho dos replies para <80 chars',
      expected: 'Replies curtos têm melhor engajamento'
    })
  }

  return analysis
}

/**
 * Gera ajustes de estratégia para amanhã
 */
function generateTomorrowStrategy(analysis, currentStrategy) {
  const adjustments = []

  for (const action of analysis.urgentActions) {
    if (action.priority === 'critical') {
      adjustments.push({
        date: new Date().toISOString(),
        type: 'urgent',
        change: action.action,
        reason: action.reason
      })
    }
  }

  for (const rec of analysis.recommendations) {
    if (rec.priority === 'high') {
      adjustments.push({
        date: new Date().toISOString(),
        type: 'recommendation',
        change: rec.action,
        reason: rec.expected
      })
    }
  }

  return adjustments
}

/**
 * Gera relatório formatado
 */
function generateReport(today, comparison, analysis) {
  const lines = []
  const date = new Date().toLocaleDateString('pt-BR')

  lines.push('═'.repeat(55))
  lines.push(`🌙 RELATÓRIO NOTURNO - ${date}`)
  lines.push('═'.repeat(55))

  // Métricas de hoje
  lines.push('\n📊 MÉTRICAS DO DIA:')
  const parsed = today.parsed || {}
  if (Object.keys(parsed).length === 0) {
    lines.push('  ⚠️ Não foi possível extrair métricas automaticamente')
    lines.push('  📸 Verifique o screenshot em data/analytics-screenshot.png')
  } else {
    for (const [key, value] of Object.entries(parsed)) {
      if (value !== null) {
        const formatted = typeof value === 'number' ? value.toLocaleString('pt-BR') : value
        lines.push(`  • ${key}: ${formatted}`)
      }
    }
  }

  // Comparação com ontem
  if (comparison.hasYesterday) {
    lines.push('\n📈 COMPARAÇÃO COM ONTEM:')
    for (const [metric, change] of Object.entries(comparison.changes)) {
      const arrow = change.diff > 0 ? '↑' : change.diff < 0 ? '↓' : '→'
      const color = change.diff > 0 ? '🟢' : change.diff < 0 ? '🔴' : '⚪'
      lines.push(`  ${color} ${metric}: ${change.yesterday} → ${change.today} (${arrow}${change.percentChange}%)`)
    }
  } else {
    lines.push('\n📈 Primeiro dia de coleta - sem comparação disponível')
  }

  // Status geral
  lines.push('\n' + '─'.repeat(55))
  const statusEmoji = analysis.status === 'ahead' ? '🚀' : analysis.status === 'behind' ? '⚠️' : '✅'
  lines.push(`${statusEmoji} STATUS: ${analysis.status.toUpperCase()}`)

  // Insights
  if (analysis.insights.length > 0) {
    lines.push('\n💡 INSIGHTS:')
    for (const insight of analysis.insights) {
      const icon = insight.type === 'success' ? '✅' : insight.type === 'warning' ? '⚠️' : 'ℹ️'
      lines.push(`  ${icon} ${insight.message}`)
    }
  }

  // Ações urgentes
  if (analysis.urgentActions.length > 0) {
    lines.push('\n🔴 AÇÕES URGENTES:')
    for (const action of analysis.urgentActions) {
      lines.push(`  • ${action.action}`)
      lines.push(`    Razão: ${action.reason}`)
    }
  }

  // Recomendações para amanhã
  if (analysis.recommendations.length > 0) {
    lines.push('\n📋 AJUSTES PARA AMANHÃ:')
    for (const rec of analysis.recommendations) {
      const priority = rec.priority === 'high' ? '🔴' : '🟡'
      lines.push(`  ${priority} [${rec.area}] ${rec.action}`)
    }
  }

  // Progresso para metas
  lines.push('\n🎯 PROGRESSO PARA MONETIZAÇÃO:')
  lines.push(`  • 500 Premium followers: ${parsed.followers || '?'}/${GOALS.premiumFollowers}`)
  lines.push(`  • 5M impressões/3 meses: meta diária ${GOALS.dailyImpressions.toLocaleString()}`)

  lines.push('\n' + '═'.repeat(55))

  return lines.join('\n')
}

/**
 * Envia relatório via Telegram
 */
async function sendTelegramReport(report) {
  const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID

  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log(`${COLORS.yellow}⚠️ Telegram não configurado${COLORS.reset}`)
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
    console.error(`${COLORS.red}Erro Telegram: ${e.message}${COLORS.reset}`)
  }
}

/**
 * Função principal
 */
async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')

  console.log(`\n${COLORS.bold}🌙 Nightly Analytics - Bot-X-Reply${COLORS.reset}\n`)

  // Conecta ao Chrome
  const browser = await connectToChrome()

  // Coleta métricas
  const today = await collectAnalytics(browser)
  await browser.disconnect()

  if (!today) {
    console.error(`${COLORS.red}Falha ao coletar métricas${COLORS.reset}`)
    process.exit(1)
  }

  // Carrega histórico
  const history = loadAnalyticsHistory()
  let strategy = loadStrategy()

  // Compara com ontem
  const comparison = compareWithYesterday(today, history)

  // Analisa progresso
  const analysis = analyzeProgress(today, comparison)

  // Gera ajustes para amanhã
  const adjustments = generateTomorrowStrategy(analysis, strategy.currentStrategy)

  // Gera relatório
  const report = generateReport(today, comparison, analysis)

  // Mostra no console
  console.log('\n' + report)

  if (!dryRun) {
    // Salva entry de hoje
    history.entries.push({
      date: today.date,
      timestamp: today.timestamp,
      raw: today.raw,
      parsed: today.parsed
    })
    // Mantém últimos 90 dias
    history.entries = history.entries.slice(-90)

    // Salva comparação
    history.dailyComparisons.push({
      date: today.date,
      comparison,
      analysis
    })
    history.dailyComparisons = history.dailyComparisons.slice(-30)

    saveAnalyticsHistory(history)
    console.log(`\n${COLORS.green}✅ Dados salvos em data/nightly-analytics.json${COLORS.reset}`)

    // Adiciona ajustes à estratégia
    if (adjustments.length > 0) {
      strategy.adjustmentHistory = strategy.adjustmentHistory || []
      strategy.adjustmentHistory.push(...adjustments)
      strategy.adjustmentHistory = strategy.adjustmentHistory.slice(-50)
      strategy.lastNightlyAnalysis = today.date
      saveStrategy(strategy)
      console.log(`${COLORS.yellow}🔧 ${adjustments.length} ajustes adicionados à estratégia${COLORS.reset}`)
    }

    // Envia no Telegram
    await sendTelegramReport(report)
  } else {
    console.log(`\n${COLORS.yellow}⚠️ Modo dry-run: nada foi salvo${COLORS.reset}`)
  }
}

main().catch(e => {
  console.error(`${COLORS.red}Erro: ${e.message}${COLORS.reset}`)
  process.exit(1)
})
