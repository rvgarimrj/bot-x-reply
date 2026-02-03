#!/usr/bin/env node

/**
 * Dashboard Analyzer - Coleta e analisa métricas do X Analytics
 *
 * Funcionalidades:
 * 1. Coleta métricas do dashboard (seguidores, engajamento, impressões)
 * 2. Correlaciona com replies postados
 * 3. Identifica padrões de sucesso/fracasso
 * 4. Gera recomendações de ajuste de estratégia
 *
 * Uso:
 *   node scripts/dashboard-analyzer.js           # Coleta + análise
 *   node scripts/dashboard-analyzer.js --report  # Só mostra relatório
 */

import puppeteer from 'puppeteer-core'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DASHBOARD_PATH = path.join(__dirname, '..', 'data', 'dashboard-history.json')
const KNOWLEDGE_PATH = path.join(__dirname, '..', 'data', 'knowledge.json')
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
    console.log('Execute primeiro:')
    console.log('"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222 --user-data-dir="$HOME/.chrome-bot-profile" &')
    process.exit(1)
  }
}

/**
 * Coleta métricas do dashboard do X Analytics
 */
async function collectDashboardMetrics(browser) {
  console.log(`\n${COLORS.cyan}📊 Coletando métricas do dashboard...${COLORS.reset}\n`)

  const page = await browser.newPage()

  try {
    await page.setDefaultTimeout(60000)

    // Navega para o dashboard
    await page.goto('https://x.com/i/account_analytics', {
      waitUntil: 'networkidle2',
      timeout: 30000
    })

    // Aguarda carregar
    await new Promise(r => setTimeout(r, 5000))

    // Tenta extrair métricas do HTML
    const metrics = await page.evaluate(() => {
      const data = {
        date: new Date().toISOString(),
        period: '7D',
        followers: {},
        engagement: {},
        content: {},
        raw: {}
      }

      // Função auxiliar para extrair número de texto
      const extractNumber = (text) => {
        if (!text) return null
        // Remove K, M e converte
        const clean = text.replace(/,/g, '').trim()
        if (clean.includes('K')) return parseFloat(clean) * 1000
        if (clean.includes('M')) return parseFloat(clean) * 1000000
        return parseFloat(clean) || null
      }

      // Função para extrair porcentagem de mudança
      const extractChange = (text) => {
        if (!text) return null
        const match = text.match(/([+-]?\d+(?:\.\d+)?%?)/)
        if (match) {
          const val = match[1].replace('%', '')
          return parseFloat(val) || null
        }
        return null
      }

      // Busca todos os textos visíveis que parecem métricas
      const allText = document.body.innerText

      // Padrões comuns no dashboard do X
      const patterns = {
        followers: /(?:Seguidores|Followers)[^\d]*(\d+(?:,\d+)*(?:\.\d+)?[KM]?)/i,
        impressions: /(?:Impressões|Impressions)[^\d]*(\d+(?:,\d+)*(?:\.\d+)?[KM]?)/i,
        engagementRate: /(?:Taxa de engajamento|Engagement rate)[^\d]*(\d+(?:\.\d+)?%?)/i,
        engagements: /(?:Engajamentos|Engagements)[^\d]*(\d+(?:,\d+)*(?:\.\d+)?[KM]?)/i,
        profileVisits: /(?:Visitas ao perfil|Profile visits)[^\d]*(\d+(?:,\d+)*(?:\.\d+)?[KM]?)/i,
        replies: /(?:Respostas|Replies)[^\d]*(\d+(?:,\d+)*(?:\.\d+)?[KM]?)/i,
        likes: /(?:Curtidas|Likes)[^\d]*(\d+(?:,\d+)*(?:\.\d+)?[KM]?)/i,
        reposts: /(?:Reposts|Retweets)[^\d]*(\d+(?:,\d+)*(?:\.\d+)?[KM]?)/i
      }

      for (const [key, pattern] of Object.entries(patterns)) {
        const match = allText.match(pattern)
        if (match) {
          data.raw[key] = match[1]
          data.engagement[key] = extractNumber(match[1])
        }
      }

      // Tenta pegar dados de seguidores do gráfico
      const followerElements = document.querySelectorAll('[data-testid*="follower"], [aria-label*="follower"], [aria-label*="seguidor"]')
      followerElements.forEach(el => {
        const text = el.textContent || el.getAttribute('aria-label')
        if (text) data.raw.followerElement = text
      })

      // Captura screenshot info para debug
      data.pageTitle = document.title
      data.url = window.location.href

      return data
    })

    // Tira screenshot para análise manual se necessário
    const screenshotPath = path.join(__dirname, '..', 'data', 'dashboard-screenshot.png')
    await page.screenshot({ path: screenshotPath, fullPage: true })
    console.log(`📸 Screenshot salvo em: data/dashboard-screenshot.png`)

    await page.close()
    return metrics

  } catch (e) {
    console.error(`${COLORS.red}Erro ao coletar métricas: ${e.message}${COLORS.reset}`)
    await page.close().catch(() => {})
    return null
  }
}

/**
 * Carrega histórico do dashboard
 */
function loadDashboardHistory() {
  try {
    return JSON.parse(fs.readFileSync(DASHBOARD_PATH, 'utf-8'))
  } catch {
    return {
      version: 1,
      entries: [],
      dailyStats: {}
    }
  }
}

/**
 * Salva histórico do dashboard
 */
function saveDashboardHistory(data) {
  fs.writeFileSync(DASHBOARD_PATH, JSON.stringify(data, null, 2))
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
 * Carrega ou cria arquivo de ajustes de estratégia
 */
function loadStrategy() {
  try {
    return JSON.parse(fs.readFileSync(STRATEGY_PATH, 'utf-8'))
  } catch {
    return {
      version: 1,
      currentStrategy: {
        replyLength: 'medium',      // short, medium, long
        toneBalance: {
          agreeing: 40,             // % de replies concordando
          questioning: 30,          // % de perguntas
          contrarian: 20,           // % discordando/contrário
          personal: 10              // % experiência pessoal
        },
        targetAudience: 'nicho',    // nicho, hype, balanced
        emojiUsage: 30,             // % de replies com emoji
        maxChars: 150,              // tamanho máximo
        priorityStyles: ['question', 'observation', 'direct']
      },
      adjustmentHistory: [],
      experiments: []
    }
  }
}

/**
 * Salva ajustes de estratégia
 */
function saveStrategy(data) {
  fs.writeFileSync(STRATEGY_PATH, JSON.stringify(data, null, 2))
}

/**
 * Analisa correlação entre replies e métricas do dashboard
 */
function analyzeCorrelation(knowledge, dashboardHistory) {
  const analysis = {
    replyLengthVsEngagement: {},
    toneVsFollowers: {},
    timeVsPerformance: {},
    insights: [],
    recommendations: []
  }

  const replies = knowledge.replies || []
  const last7Days = replies.filter(r => {
    const date = new Date(r.timestamp)
    const daysAgo = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24)
    return daysAgo <= 7
  })

  // Análise por tamanho de reply
  const lengthBuckets = { short: [], medium: [], long: [] }
  for (const reply of last7Days) {
    const len = reply.replyText?.length || 0
    const bucket = len < 70 ? 'short' : len < 150 ? 'medium' : 'long'
    lengthBuckets[bucket].push(reply)
  }

  for (const [bucket, items] of Object.entries(lengthBuckets)) {
    const withMetrics = items.filter(r => r.metrics?.likes !== null && r.metrics?.likes !== undefined)
    if (withMetrics.length > 0) {
      const avgLikes = withMetrics.reduce((s, r) => s + (r.metrics.likes || 0), 0) / withMetrics.length
      const authorReplies = withMetrics.filter(r => r.metrics.authorReplied).length
      analysis.replyLengthVsEngagement[bucket] = {
        count: items.length,
        withMetrics: withMetrics.length,
        avgLikes: avgLikes.toFixed(1),
        authorReplyRate: (authorReplies / withMetrics.length * 100).toFixed(1)
      }
    }
  }

  // Identifica melhores replies (maior engajamento)
  const sortedByLikes = last7Days
    .filter(r => r.metrics?.likes !== null)
    .sort((a, b) => (b.metrics?.likes || 0) - (a.metrics?.likes || 0))

  const topReplies = sortedByLikes.slice(0, 5)
  const worstReplies = sortedByLikes.slice(-5).reverse()

  // Padrões nos melhores replies
  if (topReplies.length > 0) {
    const avgTopLength = topReplies.reduce((s, r) => s + (r.replyText?.length || 0), 0) / topReplies.length
    const hasQuestionTop = topReplies.filter(r => r.replyText?.includes('?')).length
    const hasEmojiTop = topReplies.filter(r => /[\u{1F600}-\u{1F64F}]/u.test(r.replyText || '')).length

    analysis.topPatterns = {
      avgLength: Math.round(avgTopLength),
      questionRate: (hasQuestionTop / topReplies.length * 100).toFixed(0),
      emojiRate: (hasEmojiTop / topReplies.length * 100).toFixed(0),
      examples: topReplies.map(r => ({
        text: r.replyText?.slice(0, 80),
        likes: r.metrics?.likes,
        author: r.tweetAuthor
      }))
    }
  }

  // Padrões nos piores replies
  if (worstReplies.length > 0) {
    const avgWorstLength = worstReplies.reduce((s, r) => s + (r.replyText?.length || 0), 0) / worstReplies.length

    analysis.worstPatterns = {
      avgLength: Math.round(avgWorstLength),
      examples: worstReplies.map(r => ({
        text: r.replyText?.slice(0, 80),
        likes: r.metrics?.likes,
        author: r.tweetAuthor
      }))
    }
  }

  // Gera insights
  if (analysis.topPatterns && analysis.worstPatterns) {
    if (analysis.topPatterns.avgLength < analysis.worstPatterns.avgLength - 30) {
      analysis.insights.push({
        type: 'success',
        finding: 'Replies curtos performam melhor',
        detail: `Top replies: ${analysis.topPatterns.avgLength} chars | Piores: ${analysis.worstPatterns.avgLength} chars`,
        action: 'REDUZIR tamanho máximo dos replies'
      })
    }

    if (parseInt(analysis.topPatterns.questionRate) > 40) {
      analysis.insights.push({
        type: 'success',
        finding: 'Perguntas geram mais engajamento',
        detail: `${analysis.topPatterns.questionRate}% dos top replies têm pergunta`,
        action: 'AUMENTAR proporção de perguntas'
      })
    }
  }

  // Verifica author reply rate
  const withMetrics = replies.filter(r => r.metrics?.authorReplied !== undefined)
  const authorReplied = withMetrics.filter(r => r.metrics.authorReplied).length
  if (withMetrics.length > 10) {
    const rate = (authorReplied / withMetrics.length * 100)
    if (rate < 5) {
      analysis.insights.push({
        type: 'warning',
        finding: 'Taxa de author reply muito baixa',
        detail: `Apenas ${rate.toFixed(1)}% dos autores respondem`,
        action: 'Mudar para tom mais conversacional/pergunta'
      })
    }
  }

  // Recomendações baseadas nos insights
  for (const insight of analysis.insights) {
    if (insight.finding.includes('curtos')) {
      analysis.recommendations.push({
        priority: 'high',
        area: 'length',
        change: 'Reduzir maxChars de 150 para 100',
        reason: insight.detail
      })
    }
    if (insight.finding.includes('Perguntas')) {
      analysis.recommendations.push({
        priority: 'high',
        area: 'tone',
        change: 'Aumentar questioning de 30% para 50%',
        reason: insight.detail
      })
    }
    if (insight.finding.includes('author reply')) {
      analysis.recommendations.push({
        priority: 'critical',
        area: 'strategy',
        change: 'Focar em perguntas genuínas que pedem resposta',
        reason: insight.detail
      })
    }
  }

  return analysis
}

/**
 * Gera ajustes automáticos de estratégia
 */
function generateStrategyAdjustments(analysis, currentStrategy) {
  const adjustments = []

  for (const rec of analysis.recommendations || []) {
    if (rec.priority === 'critical' || rec.priority === 'high') {
      adjustments.push({
        date: new Date().toISOString(),
        area: rec.area,
        change: rec.change,
        reason: rec.reason,
        applied: false
      })
    }
  }

  return adjustments
}

/**
 * Imprime relatório
 */
function printReport(analysis, strategy, dashboardMetrics) {
  console.log('\n' + '═'.repeat(70))
  console.log(`${COLORS.bold}  📈 ANÁLISE DO DASHBOARD + CORRELAÇÃO COM REPLIES${COLORS.reset}`)
  console.log(`  Gerado em: ${new Date().toLocaleString('pt-BR')}`)
  console.log('═'.repeat(70))

  // Métricas do dashboard (se coletadas)
  if (dashboardMetrics && Object.keys(dashboardMetrics.engagement || {}).length > 0) {
    console.log(`\n${COLORS.cyan}━━━ MÉTRICAS DO DASHBOARD (7D) ━━━${COLORS.reset}`)
    for (const [key, value] of Object.entries(dashboardMetrics.engagement)) {
      console.log(`  ${key}: ${value}`)
    }
  }

  // Performance por tamanho de reply
  console.log(`\n${COLORS.cyan}━━━ PERFORMANCE POR TAMANHO DE REPLY ━━━${COLORS.reset}`)
  if (Object.keys(analysis.replyLengthVsEngagement).length === 0) {
    console.log(`  ${COLORS.yellow}Dados insuficientes${COLORS.reset}`)
  } else {
    console.log('  Tamanho    | Count | Avg Likes | Author Reply%')
    console.log('  ' + '─'.repeat(50))
    for (const [size, data] of Object.entries(analysis.replyLengthVsEngagement)) {
      const sizeLabel = size.padEnd(10)
      console.log(`  ${sizeLabel} | ${String(data.count).padStart(5)} | ${data.avgLikes.padStart(9)} | ${data.authorReplyRate}%`)
    }
  }

  // Top patterns
  if (analysis.topPatterns) {
    console.log(`\n${COLORS.cyan}━━━ PADRÕES DOS MELHORES REPLIES ━━━${COLORS.reset}`)
    console.log(`  Tamanho médio: ${analysis.topPatterns.avgLength} chars`)
    console.log(`  % com pergunta: ${analysis.topPatterns.questionRate}%`)
    console.log(`  % com emoji: ${analysis.topPatterns.emojiRate}%`)
    console.log(`\n  Exemplos:`)
    for (const ex of analysis.topPatterns.examples.slice(0, 3)) {
      console.log(`  ${COLORS.green}[${ex.likes} likes]${COLORS.reset} "${ex.text}..."`)
    }
  }

  // Worst patterns
  if (analysis.worstPatterns) {
    console.log(`\n${COLORS.cyan}━━━ PADRÕES DOS PIORES REPLIES ━━━${COLORS.reset}`)
    console.log(`  Tamanho médio: ${analysis.worstPatterns.avgLength} chars`)
    console.log(`\n  Exemplos:`)
    for (const ex of analysis.worstPatterns.examples.slice(0, 3)) {
      console.log(`  ${COLORS.red}[${ex.likes} likes]${COLORS.reset} "${ex.text}..."`)
    }
  }

  // Insights
  console.log(`\n${COLORS.cyan}━━━ INSIGHTS DESCOBERTOS ━━━${COLORS.reset}`)
  if (analysis.insights.length === 0) {
    console.log(`  ${COLORS.yellow}Nenhum insight ainda (precisa de mais dados)${COLORS.reset}`)
  } else {
    for (const insight of analysis.insights) {
      const icon = insight.type === 'success' ? '✅' : '⚠️'
      const color = insight.type === 'success' ? COLORS.green : COLORS.yellow
      console.log(`  ${icon} ${color}${insight.finding}${COLORS.reset}`)
      console.log(`     ${insight.detail}`)
      console.log(`     └─ ${COLORS.bold}Ação: ${insight.action}${COLORS.reset}`)
    }
  }

  // Recomendações de ajuste
  console.log(`\n${COLORS.cyan}━━━ AJUSTES RECOMENDADOS ━━━${COLORS.reset}`)
  if (analysis.recommendations.length === 0) {
    console.log(`  ${COLORS.green}✅ Estratégia atual parece adequada${COLORS.reset}`)
  } else {
    for (const rec of analysis.recommendations) {
      const priorityColor = rec.priority === 'critical' ? COLORS.red : rec.priority === 'high' ? COLORS.yellow : COLORS.blue
      console.log(`  ${priorityColor}[${rec.priority.toUpperCase()}]${COLORS.reset} ${rec.change}`)
      console.log(`     Razão: ${rec.reason}`)
    }
  }

  // Estratégia atual
  console.log(`\n${COLORS.cyan}━━━ ESTRATÉGIA ATUAL ━━━${COLORS.reset}`)
  console.log(`  Tamanho máx: ${strategy.currentStrategy.maxChars} chars`)
  console.log(`  Tom: ${strategy.currentStrategy.toneBalance.agreeing}% concordando, ${strategy.currentStrategy.toneBalance.questioning}% perguntas`)
  console.log(`  Emojis: ${strategy.currentStrategy.emojiUsage}%`)
  console.log(`  Estilos prioritários: ${strategy.currentStrategy.priorityStyles.join(', ')}`)

  console.log('\n' + '═'.repeat(70))
  console.log(`  ${COLORS.bold}💡 Execute com --apply para aplicar ajustes automaticamente${COLORS.reset}`)
  console.log('═'.repeat(70) + '\n')
}

/**
 * Aplica ajustes à estratégia
 */
function applyAdjustments(strategy, adjustments) {
  for (const adj of adjustments) {
    if (adj.area === 'length') {
      strategy.currentStrategy.maxChars = 100
      adj.applied = true
    }
    if (adj.area === 'tone') {
      strategy.currentStrategy.toneBalance.questioning = 50
      strategy.currentStrategy.toneBalance.agreeing = 25
      strategy.currentStrategy.priorityStyles = ['question', 'observation', 'direct']
      adj.applied = true
    }
    if (adj.area === 'strategy') {
      // Adiciona experimento
      strategy.experiments.push({
        id: Date.now(),
        name: 'more_questions',
        description: 'Aumentar perguntas genuínas para incentivar author replies',
        startDate: new Date().toISOString(),
        changes: {
          questioning: 50,
          maxChars: 100,
          priorityStyles: ['question', 'direct']
        },
        status: 'active'
      })
      adj.applied = true
    }
  }

  strategy.adjustmentHistory.push(...adjustments)
  return strategy
}

/**
 * Função principal
 */
async function main() {
  const args = process.argv.slice(2)
  const reportOnly = args.includes('--report')
  const applyChanges = args.includes('--apply')

  console.log(`\n${COLORS.bold}📊 Dashboard Analyzer - Bot-X-Reply${COLORS.reset}\n`)

  // Carrega dados
  let dashboardMetrics = null
  const dashboardHistory = loadDashboardHistory()
  const knowledge = loadKnowledge()
  let strategy = loadStrategy()

  // Coleta métricas do dashboard (se não for --report)
  if (!reportOnly) {
    const browser = await connectToChrome()
    dashboardMetrics = await collectDashboardMetrics(browser)

    if (dashboardMetrics) {
      dashboardHistory.entries.push(dashboardMetrics)
      // Mantém últimos 30 dias
      dashboardHistory.entries = dashboardHistory.entries.slice(-30)
      saveDashboardHistory(dashboardHistory)
      console.log(`${COLORS.green}✅ Métricas salvas em data/dashboard-history.json${COLORS.reset}`)
    }

    await browser.disconnect()
  }

  // Analisa correlação
  const analysis = analyzeCorrelation(knowledge, dashboardHistory)

  // Gera ajustes
  const adjustments = generateStrategyAdjustments(analysis, strategy)

  // Imprime relatório
  printReport(analysis, strategy, dashboardMetrics)

  // Aplica ajustes se solicitado
  if (applyChanges && adjustments.length > 0) {
    console.log(`\n${COLORS.yellow}🔧 Aplicando ajustes...${COLORS.reset}\n`)
    strategy = applyAdjustments(strategy, adjustments)
    saveStrategy(strategy)
    console.log(`${COLORS.green}✅ Estratégia atualizada em data/strategy-adjustments.json${COLORS.reset}`)
    console.log(`${COLORS.bold}⚠️  Reinicie o daemon para aplicar: pkill -2 -f auto-daemon && node scripts/auto-daemon.js${COLORS.reset}\n`)
  }
}

main().catch(e => {
  console.error(`${COLORS.red}Erro: ${e.message}${COLORS.reset}`)
  process.exit(1)
})
