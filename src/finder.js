import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { analyzeTweetPotential } from './claude.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const KNOWLEDGE_PATH = join(__dirname, '../data/knowledge.json')

// Carrega configurações
const accountsPath = join(__dirname, '../config/accounts.json')
let accountsConfig = {}
try {
  accountsConfig = JSON.parse(readFileSync(accountsPath, 'utf-8'))
} catch (e) {
  console.warn('Configuração de contas não encontrada, usando padrões')
  accountsConfig = { manual: [], filters: {} }
}

/**
 * Configuração de limites diários
 */
const DAILY_LIMITS = {
  min: 50,      // Mínimo obrigatório
  normal: 70,   // Meta normal
  max: 80       // Limite máximo (anti-bot)
}

/**
 * Estado do finder
 */
const state = {
  lastSearch: null,
  tweetsCache: [],
  processedTweets: new Set(), // URLs já processados
  dailyStats: {
    date: new Date().toDateString(),
    repliesPosted: 0,
    tweetsAnalyzed: 0,
    errors: 0,
    postsReplied: new Set(),         // URLs respondidos HOJE
    accountsEngaged: new Map(),      // account -> count (max 3/dia)
    stylesUsed: [],                  // Últimos 5 estilos usados
    languageBreakdown: { en: 0, pt: 0, other: 0 }
  }
}

/**
 * Reseta stats diários se mudou o dia
 */
function checkDailyReset() {
  const today = new Date().toDateString()
  if (state.dailyStats.date !== today) {
    state.dailyStats = {
      date: today,
      repliesPosted: 0,
      tweetsAnalyzed: 0,
      errors: 0,
      postsReplied: new Set(),
      accountsEngaged: new Map(),
      stylesUsed: [],
      languageBreakdown: { en: 0, pt: 0, other: 0 }
    }
    state.processedTweets.clear() // Limpa URLs processados do dia anterior
  }
}

/**
 * Verifica se já atingiu limite diário máximo
 */
export function canPostMore() {
  checkDailyReset()
  return state.dailyStats.repliesPosted < DAILY_LIMITS.max
}

/**
 * Retorna limites diários configurados
 */
export function getDailyLimits() {
  return { ...DAILY_LIMITS }
}

/**
 * Verifica se deve postar baseado no progresso e qualidade do tweet
 */
export function shouldPostReply(tweetScore = 50) {
  checkDailyReset()
  const count = state.dailyStats.repliesPosted
  const HIGH_QUALITY_THRESHOLD = 80

  if (count < DAILY_LIMITS.min) return true     // Ainda não atingiu mínimo
  if (count >= DAILY_LIMITS.max) return false   // No limite máximo

  // Entre min e normal: sempre posta
  if (count < DAILY_LIMITS.normal) return true

  // Entre normal e max: só se tweet for muito bom
  return tweetScore >= HIGH_QUALITY_THRESHOLD
}

/**
 * Verifica se pode engajar com uma conta específica (max 3/dia)
 */
export function canEngageAccount(username) {
  checkDailyReset()
  const count = state.dailyStats.accountsEngaged.get(username.toLowerCase()) || 0
  return count < 3
}

/**
 * Verifica se já respondeu a um tweet específico hoje
 */
export function hasRepliedToday(tweetUrl) {
  checkDailyReset()
  return state.dailyStats.postsReplied.has(tweetUrl)
}

/**
 * Registra um reply postado
 */
export function recordReply(tweetUrl, options = {}) {
  checkDailyReset()
  state.dailyStats.repliesPosted++
  state.processedTweets.add(tweetUrl)
  state.dailyStats.postsReplied.add(tweetUrl)

  // Registra conta engajada
  if (options.author) {
    const author = options.author.toLowerCase()
    const count = state.dailyStats.accountsEngaged.get(author) || 0
    state.dailyStats.accountsEngaged.set(author, count + 1)
  }

  // Registra idioma
  if (options.language) {
    const lang = options.language === 'en' || options.language === 'pt' ? options.language : 'other'
    state.dailyStats.languageBreakdown[lang]++
  }

  // Registra estilo usado (mantém últimos 5)
  if (options.style) {
    state.dailyStats.stylesUsed.push(options.style)
    if (state.dailyStats.stylesUsed.length > 5) {
      state.dailyStats.stylesUsed.shift()
    }
  }
}

/**
 * Registra um erro
 */
export function recordError(errorMsg) {
  checkDailyReset()
  state.dailyStats.errors++
}

/**
 * Retorna estilos usados recentemente (para rotação)
 */
export function getRecentStyles() {
  checkDailyReset()
  return [...state.dailyStats.stylesUsed]
}

/**
 * Retorna top contas engajadas no dia
 */
export function getTopAccountsEngaged(limit = 5) {
  checkDailyReset()
  const entries = Array.from(state.dailyStats.accountsEngaged.entries())
  return entries
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }))
}

/**
 * Lê replies do dia do knowledge.json (fonte de verdade)
 */
function getRepliesFromKnowledge(dateStr) {
  try {
    if (!existsSync(KNOWLEDGE_PATH)) return []
    const knowledge = JSON.parse(readFileSync(KNOWLEDGE_PATH, 'utf-8'))
    const replies = knowledge.replies || []
    // Filtra replies do dia especificado
    return replies.filter(r => r.timestamp && r.timestamp.startsWith(dateStr))
  } catch (e) {
    console.warn('Erro ao ler knowledge.json:', e.message)
    return []
  }
}

/**
 * Retorna estatísticas do dia - LÊ DO KNOWLEDGE.JSON para dados precisos!
 */
export function getDailyStats() {
  checkDailyReset()

  // Formato da data para busca no knowledge.json: "2026-02-03"
  const today = new Date()
  const dateStr = today.toISOString().split('T')[0]

  // Lê replies REAIS do knowledge.json
  const todayReplies = getRepliesFromKnowledge(dateStr)

  // Calcula estatísticas reais
  const languageBreakdown = { en: 0, pt: 0, other: 0 }
  const accountsMap = new Map()
  let errors = 0

  for (const reply of todayReplies) {
    // Idioma
    const lang = reply.language || 'other'
    if (lang === 'en' || lang === 'pt') {
      languageBreakdown[lang]++
    } else {
      languageBreakdown.other++
    }

    // Contas
    if (reply.tweetAuthor) {
      const author = reply.tweetAuthor.toLowerCase()
      accountsMap.set(author, (accountsMap.get(author) || 0) + 1)
    }
  }

  // Top accounts
  const topAccounts = Array.from(accountsMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([account, count]) => ({ account, count }))

  const repliesPosted = todayReplies.length

  // Também atualiza o state in-memory para consistência
  state.dailyStats.repliesPosted = Math.max(state.dailyStats.repliesPosted, repliesPosted)

  return {
    date: state.dailyStats.date,
    repliesPosted,
    tweetsAnalyzed: state.dailyStats.tweetsAnalyzed,
    errors: state.dailyStats.errors,
    languageBreakdown,
    topAccounts,
    successRate: repliesPosted > 0
      ? Math.round(((repliesPosted - errors) / repliesPosted) * 100)
      : 100
  }
}

/**
 * Filtra tweets baseado nas configurações
 */
export function filterTweets(tweets) {
  const filters = accountsConfig.filters || {}
  const maxAgeHours = accountsConfig.max_tweet_age_hours || 12
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000
  const now = Date.now()

  return tweets.filter(tweet => {
    // Já foi processado?
    if (state.processedTweets.has(tweet.url)) {
      return false
    }

    // Muito antigo?
    if (tweet.timestamp) {
      const tweetAge = now - new Date(tweet.timestamp).getTime()
      if (tweetAge > maxAgeMs) {
        return false
      }
    }

    // Engajamento mínimo
    if (filters.min_likes && (tweet.likes || 0) < filters.min_likes) {
      return false
    }
    if (filters.min_replies && (tweet.replies || 0) < filters.min_replies) {
      return false
    }

    // Excluir retweets
    if (filters.exclude_retweets && tweet.isRetweet) {
      return false
    }

    // Excluir ads
    if (filters.exclude_ads && tweet.isAd) {
      return false
    }

    return true
  })
}

/**
 * Ordena tweets por potencial de engajamento
 */
export function rankTweets(tweets) {
  return tweets
    .map(tweet => ({
      ...tweet,
      score: calculateScore(tweet)
    }))
    .sort((a, b) => b.score - a.score)
}

/**
 * Calcula score de um tweet
 */
function calculateScore(tweet) {
  let score = 0

  // Engajamento atual (normalizado)
  score += Math.log10((tweet.likes || 1) + 1) * 10
  score += Math.log10((tweet.replies || 1) + 1) * 5
  score += Math.log10((tweet.retweets || 1) + 1) * 7

  // Bonus para tweets recentes
  if (tweet.timestamp) {
    const ageHours = (Date.now() - new Date(tweet.timestamp).getTime()) / 3600000
    if (ageHours < 1) score += 20
    else if (ageHours < 3) score += 15
    else if (ageHours < 6) score += 10
    else if (ageHours < 12) score += 5
  }

  // Bonus para contas na lista manual
  if (accountsConfig.manual?.includes(tweet.author?.toLowerCase())) {
    score += 25
  }

  // Penalidade para threads longas
  if (tweet.isThread && tweet.threadPosition > 3) {
    score -= 10
  }

  return Math.round(score)
}

/**
 * Analisa tweets com Claude e retorna os melhores
 */
export async function analyzeBestTweets(tweets, maxResults = 5) {
  checkDailyReset()

  // Filtra e rankeia primeiro
  const filtered = filterTweets(tweets)
  const ranked = rankTweets(filtered)

  // Pega top candidatos para análise detalhada
  const candidates = ranked.slice(0, maxResults * 2)

  const analyzed = []
  for (const tweet of candidates) {
    if (analyzed.length >= maxResults) break

    state.dailyStats.tweetsAnalyzed++

    const analysis = await analyzeTweetPotential(tweet)

    // Só inclui se score >= 6 e não tem skip_reason
    if (analysis.score >= 6 && !analysis.skip_reason) {
      analyzed.push({
        ...tweet,
        analysis
      })
    }
  }

  return analyzed
}

/**
 * Lista de contas para monitorar
 */
export function getAccountsToMonitor() {
  return accountsConfig.manual || []
}

/**
 * Retorna configurações atuais
 */
export function getConfig() {
  return { ...accountsConfig }
}

/**
 * Atualiza cache de tweets
 */
export function updateCache(tweets) {
  state.tweetsCache = tweets
  state.lastSearch = Date.now()
}

/**
 * Retorna tweets do cache
 */
export function getCachedTweets() {
  return state.tweetsCache
}

/**
 * Verifica se precisa buscar novos tweets
 */
export function needsRefresh(intervalMinutes = 120) {
  if (!state.lastSearch) return true
  const elapsed = Date.now() - state.lastSearch
  return elapsed > intervalMinutes * 60 * 1000
}

export default {
  canPostMore,
  shouldPostReply,
  canEngageAccount,
  hasRepliedToday,
  recordReply,
  recordError,
  getDailyStats,
  getDailyLimits,
  getRecentStyles,
  getTopAccountsEngaged,
  filterTweets,
  rankTweets,
  analyzeBestTweets,
  getAccountsToMonitor,
  getConfig,
  updateCache,
  getCachedTweets,
  needsRefresh
}
