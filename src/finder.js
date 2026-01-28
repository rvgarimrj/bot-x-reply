import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { analyzeTweetPotential } from './claude.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

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
 * Estado do finder
 */
const state = {
  lastSearch: null,
  tweetsCache: [],
  processedTweets: new Set(), // URLs já processados
  dailyStats: {
    date: new Date().toDateString(),
    repliesPosted: 0,
    tweetsAnalyzed: 0
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
      tweetsAnalyzed: 0
    }
  }
}

/**
 * Verifica se já atingiu limite diário
 */
export function canPostMore() {
  checkDailyReset()
  const MAX_DAILY_REPLIES = 10
  return state.dailyStats.repliesPosted < MAX_DAILY_REPLIES
}

/**
 * Registra um reply postado
 */
export function recordReply(tweetUrl) {
  checkDailyReset()
  state.dailyStats.repliesPosted++
  state.processedTweets.add(tweetUrl)
}

/**
 * Retorna estatísticas do dia
 */
export function getDailyStats() {
  checkDailyReset()
  return { ...state.dailyStats }
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
  recordReply,
  getDailyStats,
  filterTweets,
  rankTweets,
  analyzeBestTweets,
  getAccountsToMonitor,
  getConfig,
  updateCache,
  getCachedTweets,
  needsRefresh
}
