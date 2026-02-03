/**
 * Targeting Service - Integração com API do Bot-Ultra-Power
 *
 * Sincroniza dados de targeting dos MVPs ativos para:
 * 1. Nova fonte de discovery (busca por keywords dos apps)
 * 2. Priorizar Hype Mode para tópicos relevantes
 * 3. Rastrear performance por app
 * 4. Enviar feedback de interações
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const DATA_DIR = join(__dirname, '../data')
const CACHE_FILE = join(DATA_DIR, 'targeting-cache.json')

// Garante que diretório existe
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true })
}

// API de Targeting (Bot-Ultra-Power)
const API_BASE = 'https://gabrielabiramia-dashboard-production.up.railway.app/api/targeting'
const API_SECRET = 'garimdreaming-stats-2026'

// Cache em memória
let memoryCache = null
let lastMemoryLoad = 0
const MEMORY_CACHE_TTL = 5 * 60 * 1000 // 5 min

/**
 * Estrutura do cache
 */
const defaultCache = {
  lastSync: null,
  apps: [],
  twitterAccounts: [],
  stats: {},
  version: 2
}

/**
 * Carrega cache do disco
 */
function loadCache() {
  // Usa cache em memória se recente
  if (memoryCache && (Date.now() - lastMemoryLoad) < MEMORY_CACHE_TTL) {
    return memoryCache
  }

  try {
    if (existsSync(CACHE_FILE)) {
      const data = JSON.parse(readFileSync(CACHE_FILE, 'utf-8'))
      memoryCache = { ...defaultCache, ...data }
      lastMemoryLoad = Date.now()
      return memoryCache
    }
  } catch (e) {
    console.warn('Erro ao carregar targeting cache:', e.message)
  }

  return { ...defaultCache }
}

/**
 * Salva cache no disco
 */
function saveCache(cache) {
  try {
    writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2))
    memoryCache = cache
    lastMemoryLoad = Date.now()
  } catch (e) {
    console.warn('Erro ao salvar targeting cache:', e.message)
  }
}

/**
 * Sincroniza dados com a API de Targeting
 * Chamado a cada 6h ou no startup
 *
 * @returns {Promise<{success: boolean, appsCount: number, error?: string}>}
 */
export async function syncTargetingData() {
  console.log('Targeting: sincronizando com API...')

  try {
    const response = await fetch(`${API_BASE}?secret=${API_SECRET}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000) // 15s timeout
    })

    if (!response.ok) {
      throw new Error(`API retornou ${response.status}`)
    }

    const data = await response.json()

    // Valida resposta
    if (!data.success || !data.activeTargeting) {
      throw new Error('Resposta inválida da API')
    }

    // Carrega cache atual para preservar stats
    const cache = loadCache()
    const existingStats = cache.stats || {}

    // Processa apps - já ordenados por urgencyScore pela API
    cache.lastSync = new Date().toISOString()
    cache.apps = data.activeTargeting.map(app => ({
      slug: app.appSlug,
      name: app.appName,
      appUrl: app.appUrl,
      portfolioUrl: app.portfolioUrl,
      launchDate: app.launchDate,
      expiresAt: app.expiresAt,
      daysActive: app.daysActive,
      score: app.score,
      urgencyScore: app.urgencyScore, // NOVO: já calculado pela API
      targetAudience: app.targetAudience || {},
      keywords: app.keywords || {},
      searchQueries: app.searchQueries || {}, // NOVO: queries otimizadas
      twitterAccounts: app.twitterAccounts || [], // NOVO: contas relevantes
      locales: app.locales || { primary: 'pt-BR', supported: ['pt-BR'] }
    }))

    // Coleta todas as contas Twitter únicas
    const allAccounts = new Set()
    cache.apps.forEach(app => {
      (app.twitterAccounts || []).forEach(acc => {
        // Remove @ se presente
        const username = acc.startsWith('@') ? acc.slice(1) : acc
        allAccounts.add(username)
      })
    })
    cache.twitterAccounts = [...allAccounts]

    // Mantém stats existentes
    cache.stats = existingStats

    saveCache(cache)

    console.log(`Targeting: ${cache.apps.length} apps sincronizados`)
    console.log(`Targeting: ${cache.twitterAccounts.length} contas Twitter para monitorar`)

    return {
      success: true,
      appsCount: cache.apps.length,
      accountsCount: cache.twitterAccounts.length
    }

  } catch (error) {
    console.error('Targeting sync erro:', error.message)

    // Se falhou mas tem cache, usa cache antigo
    const cache = loadCache()
    if (cache.apps.length > 0) {
      console.log('Targeting: usando cache existente')
      return {
        success: false,
        appsCount: cache.apps.length,
        error: error.message,
        usingCache: true
      }
    }

    return {
      success: false,
      appsCount: 0,
      error: error.message
    }
  }
}

/**
 * Retorna keywords ativas de todos os apps
 * Formato: [{ keyword, appSlug, appName, language, priority, urgencyScore }]
 */
export function getActiveKeywords() {
  const cache = loadCache()
  const keywords = []

  for (const app of cache.apps) {
    // Pula apps expirados
    if (app.expiresAt && new Date(app.expiresAt) < new Date()) {
      continue
    }

    // Processa cada locale
    for (const [locale, localeKws] of Object.entries(app.keywords || {})) {
      const language = locale.startsWith('pt') ? 'pt' : locale.startsWith('es') ? 'es' : 'en'

      // Keywords primárias (alta prioridade)
      for (const kw of (localeKws.primary || [])) {
        keywords.push({
          keyword: kw,
          appSlug: app.slug,
          appName: app.name,
          language,
          priority: 'high',
          urgencyScore: app.urgencyScore,
          daysActive: app.daysActive
        })
      }

      // Keywords secundárias (média prioridade)
      for (const kw of (localeKws.secondary || [])) {
        keywords.push({
          keyword: kw,
          appSlug: app.slug,
          appName: app.name,
          language,
          priority: 'medium',
          urgencyScore: app.urgencyScore,
          daysActive: app.daysActive
        })
      }
    }
  }

  return keywords
}

/**
 * Retorna search queries otimizadas para busca no X
 * Usa as queries já otimizadas pela API
 *
 * @param {number} count - Quantidade de queries a retornar
 * @param {string} locale - Locale preferido (pt-BR, en-US, es)
 * @returns {Array<{query: string, appSlug: string, appName: string, urgencyScore: number}>}
 */
export function getSearchQueries(count = 2, locale = 'pt-BR') {
  const cache = loadCache()

  if (cache.apps.length === 0) {
    return []
  }

  const queries = []

  // Ordena apps por urgencyScore (maior primeiro)
  const sortedApps = [...cache.apps].sort((a, b) => (b.urgencyScore || 0) - (a.urgencyScore || 0))

  // Seleciona queries de apps diferentes
  const usedApps = new Set()

  for (const app of sortedApps) {
    if (queries.length >= count) break
    if (usedApps.has(app.slug)) continue

    // Pega queries do locale preferido
    const appQueries = app.searchQueries?.[locale] || app.searchQueries?.['pt-BR'] || []

    if (appQueries.length > 0) {
      // Seleciona uma query aleatória do app
      const query = appQueries[Math.floor(Math.random() * appQueries.length)]

      queries.push({
        query: query,
        appSlug: app.slug,
        appName: app.name,
        urgencyScore: app.urgencyScore,
        portfolioUrl: app.portfolioUrl,
        locale
      })

      usedApps.add(app.slug)
    }
  }

  return queries
}

/**
 * Retorna contas Twitter para monitorar
 * Contas relevantes para os apps ativos
 */
export function getTwitterAccounts() {
  const cache = loadCache()
  return cache.twitterAccounts || []
}

/**
 * Retorna contas por app (para saber qual app a conta é relevante)
 */
export function getAccountsByApp() {
  const cache = loadCache()
  const result = {}

  for (const app of cache.apps) {
    for (const acc of (app.twitterAccounts || [])) {
      const username = acc.startsWith('@') ? acc.slice(1) : acc
      if (!result[username]) {
        result[username] = []
      }
      result[username].push({
        appSlug: app.slug,
        appName: app.name,
        urgencyScore: app.urgencyScore
      })
    }
  }

  return result
}

/**
 * Verifica se um tweet contém keyword de algum app
 * @param {string} text - Texto do tweet
 * @returns {boolean}
 */
export function shouldTargetTweet(text) {
  const match = matchTweet(text)
  return match !== null
}

/**
 * Encontra match de keyword em um tweet
 * @param {string} text - Texto do tweet
 * @returns {null | {appSlug: string, appName: string, keyword: string, priority: string, urgencyScore: number}}
 */
export function matchTweet(text) {
  if (!text) return null

  const lowerText = text.toLowerCase()
  const keywords = getActiveKeywords()

  // Ordena por urgencyScore (apps mais urgentes primeiro)
  const sorted = keywords.sort((a, b) => {
    // Primeiro por urgencyScore
    if ((b.urgencyScore || 0) !== (a.urgencyScore || 0)) {
      return (b.urgencyScore || 0) - (a.urgencyScore || 0)
    }
    // Depois por priority
    if (a.priority === 'high' && b.priority !== 'high') return -1
    if (a.priority !== 'high' && b.priority === 'high') return 1
    return 0
  })

  for (const kw of sorted) {
    // Usa word boundary para evitar falsos positivos
    const regex = new RegExp(`\\b${escapeRegex(kw.keyword)}\\b`, 'i')
    if (regex.test(lowerText)) {
      return {
        appSlug: kw.appSlug,
        appName: kw.appName,
        keyword: kw.keyword,
        priority: kw.priority,
        urgencyScore: kw.urgencyScore
      }
    }
  }

  return null
}

/**
 * Escape caracteres especiais para regex
 */
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Retorna app por slug
 */
export function getAppBySlug(slug) {
  const cache = loadCache()
  return cache.apps.find(a => a.slug === slug)
}

/**
 * Retorna todos os apps ativos
 */
export function getActiveApps() {
  const cache = loadCache()
  const now = new Date()

  return cache.apps.filter(app => {
    if (app.expiresAt && new Date(app.expiresAt) < now) {
      return false
    }
    return true
  })
}

/**
 * Envia feedback de interação para a API
 * @param {string} appSlug - Slug do app
 * @param {string} tweetId - ID do tweet
 * @param {string} action - 'replied' | 'liked' | 'skipped' | 'blocked'
 * @param {object} options - { locale, searchQuery, reason, metadata }
 */
export async function sendFeedback(appSlug, tweetId, action, options = {}) {
  try {
    const response = await fetch(`${API_BASE}/feedback?secret=${API_SECRET}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appSlug,
        tweetId,
        action,
        locale: options.locale || 'pt-BR',
        searchQuery: options.searchQuery,
        reason: options.reason,
        metadata: options.metadata
      }),
      signal: AbortSignal.timeout(10000)
    })

    if (!response.ok) {
      console.warn('Feedback API erro:', response.status)
      return false
    }

    console.log(`Feedback enviado: ${action} para ${appSlug}`)
    return true

  } catch (e) {
    console.warn('Feedback erro:', e.message)
    return false
  }
}

/**
 * Registra engajamento localmente (backup do feedback API)
 */
export function recordAppEngagement(appSlug, data = {}) {
  const cache = loadCache()

  if (!cache.stats[appSlug]) {
    cache.stats[appSlug] = {
      matches: 0,
      replies: 0,
      likes: 0,
      authorReplies: 0,
      estimatedFollows: 0
    }
  }

  const stats = cache.stats[appSlug]

  if (data.matched) stats.matches++
  if (data.replied) stats.replies++
  if (data.likes) stats.likes += data.likes
  if (data.authorReplied) stats.authorReplies++
  if (data.newFollows) stats.estimatedFollows += data.newFollows

  saveCache(cache)
}

/**
 * Retorna estatísticas por app (local)
 */
export function getAppStats() {
  const cache = loadCache()
  return cache.stats || {}
}

/**
 * Retorna apps ordenados por performance local
 */
export function getBestPerformingApps(limit = 5) {
  const cache = loadCache()
  const stats = cache.stats || {}

  const appPerformance = Object.entries(stats)
    .filter(([slug, data]) => data.replies >= 3)
    .map(([slug, data]) => {
      const app = cache.apps.find(a => a.slug === slug)
      const authorReplyRate = data.replies > 0 ? data.authorReplies / data.replies : 0
      const avgLikes = data.replies > 0 ? data.likes / data.replies : 0

      return {
        slug,
        name: app?.name || slug,
        replies: data.replies,
        authorReplyRate: Math.round(authorReplyRate * 100) / 100,
        avgLikes: Math.round(avgLikes * 10) / 10,
        estimatedFollows: data.estimatedFollows,
        performanceScore: (authorReplyRate * 100) + (avgLikes * 0.5)
      }
    })
    .sort((a, b) => b.performanceScore - a.performanceScore)

  return appPerformance.slice(0, limit)
}

/**
 * Verifica se precisa sincronizar (último sync > 6h)
 */
export function needsSync() {
  const cache = loadCache()

  if (!cache.lastSync) return true

  const lastSync = new Date(cache.lastSync)
  const hoursSinceSync = (Date.now() - lastSync.getTime()) / (1000 * 60 * 60)

  return hoursSinceSync > 6
}

/**
 * Retorna info do cache para debug
 */
export function getCacheInfo() {
  const cache = loadCache()
  return {
    lastSync: cache.lastSync,
    appsCount: cache.apps.length,
    apps: cache.apps.map(a => ({
      slug: a.slug,
      name: a.name,
      urgencyScore: a.urgencyScore,
      daysActive: a.daysActive,
      queriesCount: Object.values(a.searchQueries || {}).flat().length,
      accountsCount: (a.twitterAccounts || []).length
    })),
    twitterAccountsCount: cache.twitterAccounts?.length || 0,
    statsCount: Object.keys(cache.stats).length
  }
}

/**
 * Limpa cache (para testes)
 */
export function clearCache() {
  saveCache({ ...defaultCache })
}

export default {
  syncTargetingData,
  getActiveKeywords,
  getSearchQueries,
  getTwitterAccounts,
  getAccountsByApp,
  shouldTargetTweet,
  matchTweet,
  getAppBySlug,
  getActiveApps,
  sendFeedback,
  recordAppEngagement,
  getAppStats,
  getBestPerformingApps,
  needsSync,
  getCacheInfo,
  clearCache
}
