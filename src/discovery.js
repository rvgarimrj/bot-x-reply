import puppeteer from 'puppeteer-core'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { getRepliedTweetUrls } from './knowledge.js'
import { hasRepliedToday, canEngageAccount } from './finder.js'
import * as targeting from './targeting.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Carrega configuracao
const configPath = join(__dirname, '../config/accounts.json')
let config = {}
try {
  config = JSON.parse(readFileSync(configPath, 'utf-8'))
} catch (e) {
  console.warn('Config nao encontrada')
}

// ============================================
// NOVAS CONSTANTES PARA DISCOVERY EXPANDIDO
// ============================================

/**
 * Keywords para busca direta no X
 * Queries com min_faves garantem qualidade mínima
 */
const SEARCH_KEYWORDS = [
  // AI/Tech
  '"AI startup" min_faves:100',
  '"just shipped" min_faves:50',
  '"launched today" min_faves:100',
  '"open source" min_faves:200',

  // Crypto
  '"bitcoin" min_faves:500',
  '"eth" OR "ethereum" min_faves:300',
  '"altseason" min_faves:100',

  // Investimentos
  '"stock market" min_faves:200',
  '"fed" "rates" min_faves:100',
  '"portfolio" min_faves:100',

  // Vibe Coding
  '"cursor" "coding" min_faves:50',
  '"vibe coding" min_faves:30',

  // Small creators (high reply probability)
  '"just launched" min_faves:10',
  '"built this with" min_faves:5',
  '"side project" min_faves:10',
  '"my first" "app" min_faves:5',
  '"feedback" "launched" min_faves:10',
  '"indie hacker" min_faves:20'
]

/**
 * Contas para monitorar (não seguimos, mas queremos engajar)
 * 30 contas iniciais, 3 verificadas por ciclo
 */
const MONITOR_ACCOUNTS = [
  // AI/Tech Leaders - DEMOTED (mega-contas, nunca respondem)
  { username: 'sama', niche: 'AI', priority: 'low' },
  { username: 'karpathy', niche: 'AI', priority: 'low' },
  { username: 'ylecun', niche: 'AI', priority: 'low' },
  { username: 'elonmusk', niche: 'tech', priority: 'low' },
  { username: 'satyanadella', niche: 'tech', priority: 'low' },
  { username: 'emaborgs', niche: 'AI', priority: 'low' },
  { username: 'AndrewYNg', niche: 'AI', priority: 'low' },
  { username: 'demaborgs', niche: 'AI', priority: 'low' },

  // Startups/VCs - DEMOTED mega, kept mid
  { username: 'paulg', niche: 'startups', priority: 'low' },
  { username: 'naval', niche: 'philosophy', priority: 'low' },
  { username: 'balajis', niche: 'tech', priority: 'medium' },
  { username: 'garrytan', niche: 'VC', priority: 'medium' },
  { username: 'jason', niche: 'VC', priority: 'medium' },
  { username: 'rrhoover', niche: 'product', priority: 'medium' },

  // Crypto/Finance
  { username: 'TaviCosta', niche: 'macro', priority: 'medium' },
  { username: 'Investanswers', niche: 'crypto', priority: 'medium' },
  { username: 'DocumentingBTC', niche: 'crypto', priority: 'medium' },
  { username: 'intocryptoverse', niche: 'crypto', priority: 'medium' },
  { username: 'APompliano', niche: 'crypto', priority: 'low' },
  { username: 'TheBlock__', niche: 'crypto', priority: 'low' },
  { username: 'zaborgs', niche: 'defi', priority: 'low' },
  { username: 'coaborgs', niche: 'trading', priority: 'low' },

  // Indie Hackers/Vibe Coders (existentes)
  { username: 'levelsio', niche: 'indie', priority: 'medium' },
  { username: 'marc_loub', niche: 'indie', priority: 'high' },
  { username: 'tdinh_me', niche: 'indie', priority: 'high' },
  { username: 'dannypostmaa', niche: 'indie', priority: 'high' },
  { username: 'yaborgs', niche: 'dev', priority: 'medium' },
  { username: 'swyx', niche: 'dev', priority: 'medium' },
  { username: 'aiaborgs', niche: 'AI tools', priority: 'medium' },
  { username: 'shl', niche: 'indie', priority: 'medium' },

  // === MID-TIER CREATORS (1K-50K followers, high reply rate) ===
  { username: 'joshpitzalis', niche: 'indie', priority: 'high' },
  { username: 'dvassallo', niche: 'indie', priority: 'high' },
  { username: 'araborimof', niche: 'indie', priority: 'high' },
  { username: 'yaborimof', niche: 'AI tools', priority: 'high' },
  { username: 'jmcunning', niche: 'dev', priority: 'high' },
  { username: 'rauchg', niche: 'dev', priority: 'high' },
  { username: 't3dotgg', niche: 'dev', priority: 'high' },
  { username: 'maaborgs', niche: 'crypto', priority: 'high' },
  { username: 'nickfloats', niche: 'indie', priority: 'high' },
  { username: 'maborgs', niche: 'vibe coding', priority: 'high' }
]

/**
 * Blocklist para Hype Mode - tópicos que NÃO queremos
 * mesmo com alto engajamento
 */
const HYPE_BLOCKLIST = [
  /\b(bbb|big brother|reality|reality show)\b/i,
  /\b(bolsonaro|lula|pt |psl|governo|ministro|congresso|stf)\b/i,
  /\b(flamengo|corinthians|palmeiras|futebol|brasileirao|libertadores)\b/i,
  /\b(igreja|deus|jesus|fé|pastor|evangel)\b/i,
  /\b(política|político|eleição|voto|urna)\b/i,
  /\b(novela|celebridade|fofoca|famoso)\b/i
]

/**
 * Shuffle array (Fisher-Yates)
 */
function shuffleArray(array) {
  const arr = [...array]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/**
 * Conecta ao Chrome na porta 9222
 */
async function getBrowser() {
  try {
    const browser = await puppeteer.connect({
      browserURL: 'http://127.0.0.1:9222',
      protocolTimeout: 120000
    })
    return browser
  } catch {
    throw new Error('Chrome nao esta rodando na porta 9222')
  }
}

/**
 * Delay aleatorio
 */
function randomDelay(min, max) {
  return new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min))
}

/**
 * Fecha aba de forma segura
 */
async function safeClosePage(browser, page) {
  try {
    const pages = await browser.pages()
    if (pages.length > 1) {
      await page.close()
    }
  } catch (e) {}
}

/**
 * Calcula score de tweet para priorizacao
 *
 * Scores de bonus por fonte:
 * - Timeline: base (sem bonus)
 * - Trending: +10
 * - HackerNews: +15
 * - Creator Inspiration: +25 (curado pelo X)
 *   - Tab "replies": +15 adicional (alta conversação = chance de 75x boost)
 * - Autor engajado: +10/+25/+40 baseado em quantos replies o autor faz
 */
function calculateScore(tweet, config) {
  let score = 0
  const filters = config.filters || {}
  const isCreatorInspiration = tweet.source === 'creator_inspiration'

  // Engajamento base
  score += Math.min(tweet.likes, 10000) / 100
  score += Math.min(tweet.retweets, 1000) / 10

  // Replies: comportamento diferente por fonte
  if (isCreatorInspiration && tweet.inspirationTab === 'replies') {
    // Para "Most replies", muitos replies é BOM (alta conversação)
    // Bonus proporcional ao número de replies
    score += Math.min(tweet.replies, 500) / 10
  } else {
    // Para outras fontes, muitos replies = mais competição (penaliza gradualmente)
    if (tweet.replies > 500) {
      score -= 30
    } else if (tweet.replies > (filters.max_replies || 300)) {
      score -= 15
    }
  }

  // Bonus se recente (tweets novos têm mais visibilidade)
  if (tweet.datetime) {
    const ageHours = (Date.now() - new Date(tweet.datetime).getTime()) / 3600000
    // Creator Inspiration tem janela maior (tweets curados podem ser mais velhos)
    const maxAge = isCreatorInspiration ? 24 : (filters.max_age_hours || 6)

    if (ageHours < 1) score += 50
    else if (ageHours < 2) score += 40
    else if (ageHours < 4) score += 20
    else if (ageHours < 8) score += 10
    else if (ageHours > maxAge) score -= 30 // Penalização menor
  }

  // Bonus pergunta (convida resposta)
  if (tweet.text.includes('?')) score += 20

  // Bonus opinião (gera discussão)
  const opinionWords = /\b(think|believe|should|must|need|wrong|right|best|worst|love|hate|acho|acredito|deveria|precisa)\b/i
  if (opinionWords.test(tweet.text)) score += 15

  // Prioridade da conta configurada
  const account = config.priority_accounts?.find(a => a.username.toLowerCase() === tweet.author?.toLowerCase())
  if (account?.priority === 'high') score += 30
  else if (account?.priority === 'medium') score += 15

  // === BONUS POR FONTE ===

  // Trending topics
  if (tweet.source === 'trending') score += 10

  // HackerNews (tech relevance)
  if (tweet.source === 'hackernews') score += 15

  // Creator Inspiration (curado pelo algoritmo do X!)
  if (isCreatorInspiration) {
    score += 25 // Curado = pré-validado

    // Tab "Most replies" = alta conversação = autor provavelmente responde comentários
    // Reply que recebe reply do autor = 75x boost algorítmico!
    if (tweet.inspirationTab === 'replies') {
      score += 15
    }
  }

  // === BONUS POR AUTOR ENGAJADO ===
  // Se verificamos que o autor costuma responder comentários
  if (tweet.authorEngagementScore !== undefined) {
    if (tweet.authorEngagementScore >= 5) {
      score += 40 // Muito engajado - alta chance de 75x boost
    } else if (tweet.authorEngagementScore >= 3) {
      score += 25 // Engajado
    } else if (tweet.authorEngagementScore >= 1) {
      score += 10 // Algum engajamento
    }
  }

  // === SWEET SPOT: contas médias respondem mais ===
  const likes = tweet.likes || 0
  if (likes >= 10 && likes <= 500) score += 15   // Sweet spot: mais provável de responder
  else if (likes > 5000) score -= 15              // Mega-conta: nunca responde

  // === NOVAS FONTES ===

  // Keyword Search (busca ativa, alta relevância)
  if (tweet.source === 'keyword_search') {
    score += 12
  }

  // Monitored Accounts (contas importantes que não seguimos)
  if (tweet.source === 'monitored_account') {
    if (tweet.accountPriority === 'high') score += 25
    else if (tweet.accountPriority === 'medium') score += 15
  }

  // Hype Mode (alto engajamento fora do nicho)
  if (tweet.source === 'hype_mode') {
    score += 35 // Alto engajamento compensa
    if (tweet.isOutsideNiche) score -= 10 // Pequena penalidade por estar fora do nicho
  }

  // App Targeting (keywords dos MVPs ativos)
  if (tweet.source === 'app_targeting') {
    score += 30 // Alto valor: pode converter em usuário do app
    // Bonus extra para apps urgentes (recém-lançados)
    if (tweet.targetAppDaysActive && tweet.targetAppDaysActive <= 3) {
      score += 15
    }
  }

  // Bonus se tweet matcha keyword de app (qualquer fonte)
  if (tweet.targetApp && tweet.source !== 'app_targeting') {
    score += 15 // Match com targeting de app
  }

  return Math.round(score)
}

/**
 * Busca tweets da timeline (For You)
 */
export async function findTweetsFromTimeline(maxTweets = 5) {
  const browser = await getBrowser()

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })

    console.log('Timeline: buscando...')
    await page.goto('https://x.com/home', { waitUntil: 'networkidle2', timeout: 30000 })
    await randomDelay(2000, 4000)

    // Scroll para carregar mais
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, 600))
      await randomDelay(1500, 2500)
    }

    const tweets = await page.evaluate(() => {
      const results = []
      const articles = document.querySelectorAll('article[data-testid="tweet"]')

      articles.forEach((article, index) => {
        if (index >= 15) return

        try {
          const textEl = article.querySelector('[data-testid="tweetText"]')
          const text = textEl?.textContent?.trim() || ''

          // Pula ja curtidos
          const alreadyLiked = !!article.querySelector('[data-testid="unlike"]')
          if (alreadyLiked) return

          // Autor
          const authorEl = article.querySelector('[data-testid="User-Name"] a')
          const authorHref = authorEl?.href || ''
          const authorMatch = authorHref.match(/x\.com\/(\w+)/)
          const author = authorMatch ? authorMatch[1] : ''

          // URL e data
          const timeEl = article.querySelector('time')
          const linkEl = timeEl?.closest('a')
          const url = linkEl?.href || ''
          const datetime = timeEl?.getAttribute('datetime') || ''

          // Metricas
          const getMetric = (testId) => {
            const el = article.querySelector(`[data-testid="${testId}"]`)
            const text = el?.textContent || '0'
            const match = text.match(/[\d,.]+[KMB]?/i)
            if (!match) return 0
            let num = match[0].replace(/,/g, '')
            if (num.includes('K')) num = parseFloat(num) * 1000
            else if (num.includes('M')) num = parseFloat(num) * 1000000
            else num = parseInt(num) || 0
            return num
          }

          if (text && url && author) {
            results.push({
              author,
              text: text.slice(0, 500),
              url,
              datetime,
              likes: getMetric('like'),
              replies: getMetric('reply'),
              retweets: getMetric('retweet'),
              source: 'timeline'
            })
          }
        } catch (e) {}
      })

      return results
    })

    await safeClosePage(browser, page)
    console.log(`Timeline: ${tweets.length} tweets encontrados`)

    return tweets.map(t => ({ ...t, score: calculateScore(t, config) }))

  } catch (error) {
    console.error('Timeline erro:', error.message)
    return []
  }
}

/**
 * Busca tweets de trending topics
 */
export async function findTrendingTweets(maxTweets = 5) {
  const browser = await getBrowser()

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })

    console.log('Trending: buscando...')
    await page.goto('https://x.com/explore/tabs/trending', { waitUntil: 'networkidle2', timeout: 30000 })
    await randomDelay(2000, 4000)

    // Extrai trending topics
    const trends = await page.evaluate(() => {
      const results = []
      // Seletores para trending
      const trendCells = document.querySelectorAll('[data-testid="trend"]')

      trendCells.forEach((cell, i) => {
        if (i >= 5) return
        const text = cell.textContent || ''
        // Pega o nome do trend (geralmente o texto principal)
        const spans = cell.querySelectorAll('span')
        for (const span of spans) {
          const t = span.textContent?.trim()
          if (t && t.length > 2 && !t.includes('Trending') && !t.includes('posts')) {
            results.push(t)
            break
          }
        }
      })

      return results.slice(0, 3) // Top 3 trends
    })

    console.log(`Trending: ${trends.length} trends encontrados`)

    // Busca tweets de cada trend (nichos relevantes)
    const allTweets = []
    const relevantKeywords = ['AI', 'crypto', 'tech', 'startup', 'coding', 'dev', 'bitcoin', 'ethereum']

    for (const trend of trends.slice(0, 2)) {
      // Verifica se trend e relevante
      const isRelevant = relevantKeywords.some(kw =>
        trend.toLowerCase().includes(kw.toLowerCase())
      )
      if (!isRelevant && trends.length > 1) continue

      try {
        // Busca tweets do trend
        const searchUrl = `https://x.com/search?q=${encodeURIComponent(trend)}&src=trend_click&f=live`
        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 20000 })
        await randomDelay(2000, 3000)

        const tweets = await page.evaluate((trendName) => {
          const results = []
          const articles = document.querySelectorAll('article[data-testid="tweet"]')

          articles.forEach((article, index) => {
            if (index >= 5) return

            try {
              const textEl = article.querySelector('[data-testid="tweetText"]')
              const text = textEl?.textContent?.trim() || ''

              const alreadyLiked = !!article.querySelector('[data-testid="unlike"]')
              if (alreadyLiked) return

              const authorEl = article.querySelector('[data-testid="User-Name"] a')
              const authorHref = authorEl?.href || ''
              const authorMatch = authorHref.match(/x\.com\/(\w+)/)
              const author = authorMatch ? authorMatch[1] : ''

              const timeEl = article.querySelector('time')
              const linkEl = timeEl?.closest('a')
              const url = linkEl?.href || ''
              const datetime = timeEl?.getAttribute('datetime') || ''

              const getMetric = (testId) => {
                const el = article.querySelector(`[data-testid="${testId}"]`)
                const text = el?.textContent || '0'
                const match = text.match(/[\d,.]+[KMB]?/i)
                if (!match) return 0
                let num = match[0].replace(/,/g, '')
                if (num.includes('K')) num = parseFloat(num) * 1000
                else if (num.includes('M')) num = parseFloat(num) * 1000000
                else num = parseInt(num) || 0
                return num
              }

              if (text && url && author) {
                results.push({
                  author,
                  text: text.slice(0, 500),
                  url,
                  datetime,
                  likes: getMetric('like'),
                  replies: getMetric('reply'),
                  retweets: getMetric('retweet'),
                  source: 'trending',
                  trend: trendName
                })
              }
            } catch (e) {}
          })

          return results
        }, trend)

        allTweets.push(...tweets)
        await randomDelay(1500, 2500)
      } catch (e) {
        console.log(`Trend "${trend}" erro:`, e.message)
      }
    }

    await safeClosePage(browser, page)
    console.log(`Trending: ${allTweets.length} tweets totais`)

    return allTweets.map(t => ({ ...t, score: calculateScore(t, config) }))

  } catch (error) {
    console.error('Trending erro:', error.message)
    return []
  }
}

/**
 * Busca tweets relacionados a posts do Hacker News
 */
export async function findHackerNewsTweets(maxTweets = 3) {
  try {
    console.log('HackerNews: buscando posts...')

    // Busca top stories do HN (API publica)
    const response = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json')
    const storyIds = await response.json()

    // Pega detalhes dos top 10 stories
    const stories = []
    for (const id of storyIds.slice(0, 10)) {
      const storyRes = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)
      const story = await storyRes.json()
      if (story && story.title) {
        stories.push(story)
      }
    }

    // Filtra por keywords relevantes (AI, tech, startups)
    const relevantKeywords = ['AI', 'GPT', 'LLM', 'startup', 'YC', 'funding', 'crypto', 'bitcoin', 'code', 'programming', 'developer']
    const relevantStories = stories.filter(s =>
      relevantKeywords.some(kw =>
        s.title.toLowerCase().includes(kw.toLowerCase())
      )
    ).slice(0, 3)

    if (relevantStories.length === 0) {
      console.log('HackerNews: nenhum post relevante')
      return []
    }

    console.log(`HackerNews: ${relevantStories.length} posts relevantes`)

    // Busca tweets sobre esses topicos
    const browser = await getBrowser()
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })

    const allTweets = []

    for (const story of relevantStories) {
      try {
        // Extrai keywords do titulo
        const keywords = story.title
          .split(/\s+/)
          .filter(w => w.length > 4)
          .slice(0, 3)
          .join(' ')

        const searchUrl = `https://x.com/search?q=${encodeURIComponent(keywords)}&src=typed_query&f=live`
        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 20000 })
        await randomDelay(2000, 3000)

        const tweets = await page.evaluate((hnTitle) => {
          const results = []
          const articles = document.querySelectorAll('article[data-testid="tweet"]')

          articles.forEach((article, index) => {
            if (index >= 3) return

            try {
              const textEl = article.querySelector('[data-testid="tweetText"]')
              const text = textEl?.textContent?.trim() || ''

              const alreadyLiked = !!article.querySelector('[data-testid="unlike"]')
              if (alreadyLiked) return

              const authorEl = article.querySelector('[data-testid="User-Name"] a')
              const authorHref = authorEl?.href || ''
              const authorMatch = authorHref.match(/x\.com\/(\w+)/)
              const author = authorMatch ? authorMatch[1] : ''

              const timeEl = article.querySelector('time')
              const linkEl = timeEl?.closest('a')
              const url = linkEl?.href || ''
              const datetime = timeEl?.getAttribute('datetime') || ''

              const getMetric = (testId) => {
                const el = article.querySelector(`[data-testid="${testId}"]`)
                const text = el?.textContent || '0'
                const match = text.match(/[\d,.]+[KMB]?/i)
                if (!match) return 0
                let num = match[0].replace(/,/g, '')
                if (num.includes('K')) num = parseFloat(num) * 1000
                else if (num.includes('M')) num = parseFloat(num) * 1000000
                else num = parseInt(num) || 0
                return num
              }

              if (text && url && author) {
                results.push({
                  author,
                  text: text.slice(0, 500),
                  url,
                  datetime,
                  likes: getMetric('like'),
                  replies: getMetric('reply'),
                  retweets: getMetric('retweet'),
                  source: 'hackernews',
                  hnTitle
                })
              }
            } catch (e) {}
          })

          return results
        }, story.title)

        allTweets.push(...tweets)
        await randomDelay(1500, 2500)
      } catch (e) {
        console.log(`HN "${story.title.slice(0, 30)}..." erro:`, e.message)
      }
    }

    await safeClosePage(browser, page)
    console.log(`HackerNews: ${allTweets.length} tweets totais`)

    return allTweets.map(t => ({ ...t, score: calculateScore(t, config) }))

  } catch (error) {
    console.error('HackerNews erro:', error.message)
    return []
  }
}

// ============================================
// NOVAS FONTES DE DISCOVERY (v2)
// ============================================

/**
 * FONTE 1: Busca direta por keywords relevantes
 * Diferente do fallback do CreatorInspiration, esta roda SEMPRE em paralelo
 */
export async function findTweetsFromKeywordSearch(maxTweets = 5) {
  const browser = await getBrowser()
  const allTweets = []

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })

    // Seleciona 2 keywords aleatórias para não sobrecarregar
    const selectedKeywords = shuffleArray(SEARCH_KEYWORDS).slice(0, 2)

    console.log(`KeywordSearch: buscando ${selectedKeywords.length} queries...`)

    for (const keyword of selectedKeywords) {
      try {
        const searchUrl = `https://x.com/search?q=${encodeURIComponent(keyword)}&src=typed_query&f=live`
        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 })
        await randomDelay(2000, 3000)

        // Scroll para carregar mais
        await page.evaluate(() => window.scrollBy(0, 500))
        await randomDelay(1000, 1500)

        const tweets = await page.evaluate((searchQuery) => {
          const results = []
          const articles = document.querySelectorAll('article[data-testid="tweet"]')

          articles.forEach((article, index) => {
            if (index >= 8) return

            try {
              const textEl = article.querySelector('[data-testid="tweetText"]')
              const text = textEl?.textContent?.trim() || ''

              const alreadyLiked = !!article.querySelector('[data-testid="unlike"]')
              if (alreadyLiked) return

              const authorEl = article.querySelector('[data-testid="User-Name"] a')
              const authorHref = authorEl?.href || ''
              const authorMatch = authorHref.match(/x\.com\/(\w+)/)
              const author = authorMatch ? authorMatch[1] : ''

              const timeEl = article.querySelector('time')
              const linkEl = timeEl?.closest('a')
              const url = linkEl?.href || ''
              const datetime = timeEl?.getAttribute('datetime') || ''

              const getMetric = (testId) => {
                const el = article.querySelector(`[data-testid="${testId}"]`)
                const text = el?.textContent || '0'
                const match = text.match(/[\d,.]+[KMB]?/i)
                if (!match) return 0
                let num = match[0].replace(/,/g, '')
                if (num.includes('K')) num = parseFloat(num) * 1000
                else if (num.includes('M')) num = parseFloat(num) * 1000000
                else num = parseInt(num) || 0
                return num
              }

              if (text && url && author) {
                results.push({
                  author,
                  text: text.slice(0, 500),
                  url,
                  datetime,
                  likes: getMetric('like'),
                  replies: getMetric('reply'),
                  retweets: getMetric('retweet'),
                  source: 'keyword_search',
                  searchKeyword: searchQuery
                })
              }
            } catch (e) {}
          })

          return results
        }, keyword)

        allTweets.push(...tweets)
        await randomDelay(1500, 2500)

      } catch (e) {
        console.log(`KeywordSearch "${keyword.slice(0, 30)}..." erro:`, e.message)
      }
    }

    await safeClosePage(browser, page)
    console.log(`KeywordSearch: ${allTweets.length} tweets totais`)

    return allTweets.slice(0, maxTweets).map(t => ({ ...t, score: calculateScore(t, config) }))

  } catch (error) {
    console.error('KeywordSearch erro:', error.message)
    return []
  }
}

/**
 * FONTE 2: Monitora contas relevantes que não seguimos
 * Permite alcançar 50+ contas sem poluir a timeline
 */
export async function findTweetsFromMonitoredAccounts(maxTweets = 5) {
  const browser = await getBrowser()
  const allTweets = []

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })

    // Usa config se disponível, senão usa lista default
    const accountsList = config.monitor_accounts?.accounts?.length > 0
      ? config.monitor_accounts.accounts
      : MONITOR_ACCOUNTS

    // Seleciona 3 contas aleatórias para não sobrecarregar
    const accounts = shuffleArray(accountsList).slice(0, 3)

    console.log(`MonitoredAccounts: verificando @${accounts.map(a => a.username).join(', @')}...`)

    for (const account of accounts) {
      try {
        await page.goto(`https://x.com/${account.username}`, {
          waitUntil: 'networkidle2',
          timeout: 30000
        })
        await randomDelay(1500, 2500)

        // Extrai tweets recentes do perfil
        const tweets = await page.evaluate((acc) => {
          const results = []
          const articles = document.querySelectorAll('article[data-testid="tweet"]')

          articles.forEach((article, index) => {
            if (index >= 5) return // Só últimos 5 tweets

            try {
              const textEl = article.querySelector('[data-testid="tweetText"]')
              const text = textEl?.textContent?.trim() || ''

              // Verifica se é retweet (pula)
              const socialContext = article.querySelector('[data-testid="socialContext"]')
              if (socialContext?.textContent?.includes('reposted')) return

              const alreadyLiked = !!article.querySelector('[data-testid="unlike"]')
              if (alreadyLiked) return

              // Autor (deve ser a conta monitorada, não retweet)
              const authorEl = article.querySelector('[data-testid="User-Name"] a')
              const authorHref = authorEl?.href || ''
              const authorMatch = authorHref.match(/x\.com\/(\w+)/)
              const author = authorMatch ? authorMatch[1] : ''

              // Pula se não é da conta que estamos monitorando (é retweet)
              if (author.toLowerCase() !== acc.username.toLowerCase()) return

              const timeEl = article.querySelector('time')
              const linkEl = timeEl?.closest('a')
              const url = linkEl?.href || ''
              const datetime = timeEl?.getAttribute('datetime') || ''

              const getMetric = (testId) => {
                const el = article.querySelector(`[data-testid="${testId}"]`)
                const text = el?.textContent || '0'
                const match = text.match(/[\d,.]+[KMB]?/i)
                if (!match) return 0
                let num = match[0].replace(/,/g, '')
                if (num.includes('K')) num = parseFloat(num) * 1000
                else if (num.includes('M')) num = parseFloat(num) * 1000000
                else num = parseInt(num) || 0
                return num
              }

              if (text && url && author) {
                results.push({
                  author,
                  text: text.slice(0, 500),
                  url,
                  datetime,
                  likes: getMetric('like'),
                  replies: getMetric('reply'),
                  retweets: getMetric('retweet'),
                  source: 'monitored_account',
                  accountPriority: acc.priority,
                  accountNiche: acc.niche
                })
              }
            } catch (e) {}
          })

          return results
        }, account)

        allTweets.push(...tweets)
        await randomDelay(1500, 2500)

      } catch (e) {
        console.log(`MonitoredAccounts @${account.username} erro:`, e.message)
      }
    }

    await safeClosePage(browser, page)
    console.log(`MonitoredAccounts: ${allTweets.length} tweets totais`)

    return allTweets.slice(0, maxTweets).map(t => ({ ...t, score: calculateScore(t, config) }))

  } catch (error) {
    console.error('MonitoredAccounts erro:', error.message)
    return []
  }
}

/**
 * FONTE 3: Hype Mode - tweets com alto engajamento (fora do nicho)
 * Estratégia 70/30: 30% dos ciclos + sempre em horário de pico
 */
export async function findHighEngagementTweets(maxTweets = 3) {
  const hour = new Date().getHours()
  const isPeakHour = (hour >= 12 && hour <= 14) || (hour >= 17 && hour <= 20)

  // Usa config se disponível
  const hypeConfig = config.hype_mode || {}
  const runProbability = hypeConfig.run_probability || 0.3
  const alwaysInPeak = hypeConfig.always_in_peak_hours !== false

  // SEMPRE roda em horário de pico, 30% fora do pico
  const shouldRun = (alwaysInPeak && isPeakHour) || Math.random() < runProbability

  if (!shouldRun) {
    console.log('HypeMode: pulando (fora do horário de pico e random > 0.3)')
    return []
  }

  console.log(`HypeMode: buscando tweets de alto engajamento (isPeak=${isPeakHour})...`)

  const browser = await getBrowser()

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 900 })

    // Vai para Creator Inspiration SEM filtro de nicho
    await page.goto('https://x.com/i/jf/creators/inspiration/top_posts', {
      waitUntil: 'networkidle2',
      timeout: 30000
    })
    await randomDelay(2500, 3500)

    // Scroll para carregar mais tweets
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, 600))
      await randomDelay(1000, 1500)
    }

    // Extrai TODOS os tweets (sem filtro de relevância)
    const allTweets = await page.evaluate(() => {
      const results = []
      const articles = document.querySelectorAll('article[data-testid="tweet"]')

      articles.forEach((article, index) => {
        if (index >= 20) return

        try {
          const textEl = article.querySelector('[data-testid="tweetText"]')
          const text = textEl?.textContent?.trim() || ''

          const alreadyLiked = !!article.querySelector('[data-testid="unlike"]')
          if (alreadyLiked) return

          const authorEl = article.querySelector('[data-testid="User-Name"] a')
          const authorHref = authorEl?.href || ''
          const authorMatch = authorHref.match(/x\.com\/(\w+)/)
          const author = authorMatch ? authorMatch[1] : ''

          const timeEl = article.querySelector('time')
          const linkEl = timeEl?.closest('a')
          const url = linkEl?.href || ''
          const datetime = timeEl?.getAttribute('datetime') || ''

          const getMetric = (testId) => {
            const el = article.querySelector(`[data-testid="${testId}"]`)
            const text = el?.textContent || '0'
            const match = text.match(/[\d,.]+[KMB]?/i)
            if (!match) return 0
            let num = match[0].replace(/,/g, '')
            if (num.includes('K')) num = parseFloat(num) * 1000
            else if (num.includes('M')) num = parseFloat(num) * 1000000
            else num = parseInt(num) || 0
            return num
          }

          if (text && url && author) {
            results.push({
              author,
              text: text.slice(0, 500),
              url,
              datetime,
              likes: getMetric('like'),
              replies: getMetric('reply'),
              retweets: getMetric('retweet')
            })
          }
        } catch (e) {}
      })

      return results
    })

    await safeClosePage(browser, page)

    // Filtra por alto engajamento E não estar na blocklist
    const minLikes = hypeConfig.min_likes || 1000
    const minReplies = hypeConfig.min_replies || 300

    const highEngagement = allTweets.filter(t => {
      // Precisa ter alto engajamento
      if (t.likes < minLikes && t.replies < minReplies) return false

      // Não pode estar na blocklist
      const text = t.text.toLowerCase()
      for (const pattern of HYPE_BLOCKLIST) {
        if (pattern.test(text)) return false
      }

      return true
    })

    // Marca como hype_mode e verifica se está fora do nicho
    highEngagement.forEach(t => {
      t.source = 'hype_mode'
      t.isOutsideNiche = !isRelevantTweet(t.text)

      // Verifica se matcha alguma keyword de app (Hype Mode Inteligente)
      const match = targeting.matchTweet(t.text)
      if (match) {
        t.targetApp = match.appSlug
        t.targetAppName = match.appName
        t.targetKeyword = match.keyword
        t.isOutsideNiche = false // Se matcha app, não é fora do nicho
      }
    })

    // Ordena: tweets que matcham targeting primeiro
    highEngagement.sort((a, b) => {
      const aMatch = a.targetApp ? 1 : 0
      const bMatch = b.targetApp ? 1 : 0
      if (aMatch !== bMatch) return bMatch - aMatch // Match primeiro
      return b.likes - a.likes // Empate: mais likes
    })

    console.log(`HypeMode: ${highEngagement.length} tweets de alto engajamento encontrados`)
    const matchCount = highEngagement.filter(t => t.targetApp).length
    if (matchCount > 0) {
      console.log(`HypeMode: ${matchCount} matcham targeting de apps!`)
    }

    return highEngagement.slice(0, maxTweets).map(t => ({ ...t, score: calculateScore(t, config) }))

  } catch (error) {
    console.error('HypeMode erro:', error.message)
    return []
  }
}

/**
 * FONTE 8: App Targeting - Busca por keywords dos MVPs ativos
 * Usa dados da API de Targeting para buscar tweets relevantes aos apps
 * As queries já vêm otimizadas da API
 */
export async function findTargetingTweets(maxTweets = 5) {
  // Verifica se tem queries disponíveis (já otimizadas pela API)
  const queries = targeting.getSearchQueries(2, 'pt-BR')

  if (queries.length === 0) {
    console.log('AppTargeting: nenhuma query disponível (sync necessário?)')
    return []
  }

  console.log(`AppTargeting: buscando ${queries.length} queries...`)

  const browser = await getBrowser()
  const allTweets = []

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })

    for (const q of queries) {
      try {
        console.log(`AppTargeting: "${q.query}" (${q.appName}, urgency: ${q.urgencyScore})`)

        // Query já otimizada pela API, adiciona min_faves baseado na urgência
        const minFaves = q.urgencyScore > 70 ? 30 : 50
        const searchQuery = `${q.query} min_faves:${minFaves}`
        const searchUrl = `https://x.com/search?q=${encodeURIComponent(searchQuery)}&src=typed_query&f=live`
        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 })
        await randomDelay(2000, 3000)

        // Scroll para carregar mais
        await page.evaluate(() => window.scrollBy(0, 500))
        await randomDelay(1000, 1500)

        const tweets = await page.evaluate((queryData) => {
          const results = []
          const articles = document.querySelectorAll('article[data-testid="tweet"]')

          articles.forEach((article, index) => {
            if (index >= 8) return

            try {
              const textEl = article.querySelector('[data-testid="tweetText"]')
              const text = textEl?.textContent?.trim() || ''

              const alreadyLiked = !!article.querySelector('[data-testid="unlike"]')
              if (alreadyLiked) return

              const authorEl = article.querySelector('[data-testid="User-Name"] a')
              const authorHref = authorEl?.href || ''
              const authorMatch = authorHref.match(/x\.com\/(\w+)/)
              const author = authorMatch ? authorMatch[1] : ''

              const timeEl = article.querySelector('time')
              const linkEl = timeEl?.closest('a')
              const url = linkEl?.href || ''
              const datetime = timeEl?.getAttribute('datetime') || ''

              const getMetric = (testId) => {
                const el = article.querySelector(`[data-testid="${testId}"]`)
                const text = el?.textContent || '0'
                const match = text.match(/[\d,.]+[KMB]?/i)
                if (!match) return 0
                let num = match[0].replace(/,/g, '')
                if (num.includes('K')) num = parseFloat(num) * 1000
                else if (num.includes('M')) num = parseFloat(num) * 1000000
                else num = parseInt(num) || 0
                return num
              }

              if (text && url && author) {
                results.push({
                  author,
                  text: text.slice(0, 500),
                  url,
                  datetime,
                  likes: getMetric('like'),
                  replies: getMetric('reply'),
                  retweets: getMetric('retweet'),
                  source: 'app_targeting',
                  targetApp: queryData.appSlug,
                  targetAppName: queryData.appName,
                  targetKeyword: queryData.query,
                  targetAppUrgency: queryData.urgencyScore,
                  targetPortfolioUrl: queryData.portfolioUrl
                })
              }
            } catch (e) {}
          })

          return results
        }, q)

        // Adiciona info do app
        const app = targeting.getAppBySlug(q.appSlug)
        tweets.forEach(t => {
          t.targetAppDaysActive = app?.daysActive || 0
          t.targetAppUrgency = app?.urgencyScore || 0
        })

        allTweets.push(...tweets)
        await randomDelay(1500, 2500)

      } catch (e) {
        console.log(`AppTargeting "${q.keyword}" erro:`, e.message)
      }
    }

    await safeClosePage(browser, page)
    console.log(`AppTargeting: ${allTweets.length} tweets totais`)

    return allTweets.slice(0, maxTweets).map(t => ({ ...t, score: calculateScore(t, config) }))

  } catch (error) {
    console.error('AppTargeting erro:', error.message)
    return []
  }
}

/**
 * Descobre tweets de multiplas fontes
 * @param {number} maxTweets - Maximo de tweets a retornar
 * @param {Object} options - Opcoes de discovery
 * @param {boolean} options.checkEngagement - Se deve verificar engajamento do autor (mais lento)
 * @returns {Promise<Array>} - Tweets ordenados por score
 */
export async function discoverTweets(maxTweets = 10, options = {}) {
  console.log('\n=== DISCOVERY: Buscando tweets de 8 fontes (sequencial) ===')

  // Verifica configurações
  const discoveryConfig = config.discovery || {}
  const useCreatorInspiration = discoveryConfig.explore_creator_inspiration !== false
  const useKeywordSearch = discoveryConfig.explore_keyword_search !== false
  const useMonitoredAccounts = discoveryConfig.explore_monitored_accounts !== false
  const useHypeMode = discoveryConfig.explore_hype_mode !== false
  const useAppTargeting = discoveryConfig.explore_app_targeting !== false

  // IMPORTANTE: Rodamos em SÉRIE (uma por vez) para evitar abrir muitas abas
  // Cada função abre uma aba, usa, e fecha antes da próxima
  const allTweets = []

  // 1. Timeline
  try {
    const tweets = await findTweetsFromTimeline(5)
    allTweets.push(...tweets)
  } catch (e) {
    console.log('Timeline erro:', e.message)
  }

  // 2. Trending
  try {
    const tweets = await findTrendingTweets(5)
    allTweets.push(...tweets)
  } catch (e) {
    console.log('Trending erro:', e.message)
  }

  // 3. HackerNews
  try {
    const tweets = await findHackerNewsTweets(3)
    allTweets.push(...tweets)
  } catch (e) {
    console.log('HackerNews erro:', e.message)
  }

  // 4. Creator Inspiration
  if (useCreatorInspiration) {
    try {
      const tweets = await findCreatorInspirationTweets(8)
      allTweets.push(...tweets)
    } catch (e) {
      console.log('CreatorInspiration erro:', e.message)
    }
  }

  // 5. Keyword Search (NOVO)
  if (useKeywordSearch) {
    try {
      const tweets = await findTweetsFromKeywordSearch(5)
      allTweets.push(...tweets)
    } catch (e) {
      console.log('KeywordSearch erro:', e.message)
    }
  }

  // 6. Monitored Accounts (NOVO)
  if (useMonitoredAccounts) {
    try {
      const tweets = await findTweetsFromMonitoredAccounts(5)
      allTweets.push(...tweets)
    } catch (e) {
      console.log('MonitoredAccounts erro:', e.message)
    }
  }

  // 7. Hype Mode (NOVO)
  if (useHypeMode) {
    try {
      const tweets = await findHighEngagementTweets(3)
      allTweets.push(...tweets)
    } catch (e) {
      console.log('HypeMode erro:', e.message)
    }
  }

  // 8. App Targeting (NOVO - keywords dos MVPs)
  if (useAppTargeting) {
    try {
      const tweets = await findTargetingTweets(5)
      allTweets.push(...tweets)
    } catch (e) {
      console.log('AppTargeting erro:', e.message)
    }
  }

  // Log por fonte
  const bySource = {}
  allTweets.forEach(t => {
    bySource[t.source] = (bySource[t.source] || 0) + 1
  })
  console.log('Por fonte:', bySource)
  console.log(`Total bruto: ${allTweets.length} tweets`)

  // Remove duplicatas por URL
  const unique = allTweets.filter((t, i) =>
    allTweets.findIndex(x => x.url === t.url) === i
  )
  console.log(`Apos deduplicacao: ${unique.length} tweets`)

  // Filtra ja respondidos (base de conhecimento)
  const repliedUrls = getRepliedTweetUrls()
  let candidates = unique.filter(t => !repliedUrls.includes(t.url))
  console.log(`Apos filtro conhecimento: ${candidates.length} tweets`)

  // Filtra respondidos hoje
  candidates = candidates.filter(t => !hasRepliedToday(t.url))
  console.log(`Apos filtro dia: ${candidates.length} tweets`)

  // Filtra por limite de conta (max 3/dia)
  candidates = candidates.filter(t => canEngageAccount(t.author))
  console.log(`Apos filtro conta: ${candidates.length} tweets`)

  // Aplica filtros de config
  const filters = config.filters || {}
  candidates = candidates.filter(t => {
    if (t.likes < (filters.min_likes || 10)) return false

    // Para Creator Inspiration, NÃO filtra por max_replies
    // (queremos tweets com muitos replies = alta conversação)
    const isCreatorInspiration = t.source === 'creator_inspiration'
    if (!isCreatorInspiration && t.replies > (filters.max_replies || 200)) {
      return false
    }

    if (t.datetime) {
      const ageHours = (Date.now() - new Date(t.datetime).getTime()) / 3600000
      // Creator Inspiration tem janela maior (24h em vez de 12h)
      const maxAge = isCreatorInspiration ? 24 : (filters.max_age_hours || 12)
      if (ageHours > maxAge) return false
    }
    return true
  })
  console.log(`Apos filtros config: ${candidates.length} tweets`)

  // Ordena por score
  candidates.sort((a, b) => b.score - a.score)

  // FILTRO DE DIVERSIDADE: Max 1 tweet por autor no resultado final
  // Evita que o mesmo autor domine o ranking
  const seenAuthors = new Set()
  candidates = candidates.filter(t => {
    const authorLower = t.author?.toLowerCase()
    if (seenAuthors.has(authorLower)) {
      return false
    }
    seenAuthors.add(authorLower)
    return true
  })
  console.log(`Apos filtro diversidade (1/autor): ${candidates.length} tweets`)

  // Opcionalmente verifica engajamento do autor para top candidatos
  // (aumenta score de tweets onde autor costuma responder)
  if (options.checkEngagement && candidates.length > 0) {
    console.log('Verificando engajamento do autor para top 3...')
    const topCandidates = candidates.slice(0, 3)

    for (const tweet of topCandidates) {
      try {
        const engagement = await checkAuthorEngagement(tweet.url)
        tweet.authorEngagementScore = engagement
        // Recalcula score com bonus de engajamento
        tweet.score = calculateScore(tweet, config)
      } catch (e) {
        console.log('Erro ao verificar engajamento:', e.message)
      }
    }

    // Re-ordena após atualizar scores
    candidates.sort((a, b) => b.score - a.score)
  }

  console.log(`=== DISCOVERY: Retornando top ${Math.min(candidates.length, maxTweets)} ===\n`)

  // Log do top 3 para debug
  candidates.slice(0, 3).forEach((t, i) => {
    console.log(`  #${i + 1}: @${t.author} | score=${t.score} | source=${t.source}${t.inspirationTab ? '/' + t.inspirationTab : ''}`)
  })

  return candidates.slice(0, maxTweets)
}

/**
 * Recarrega config do disco
 */
export function reloadConfig() {
  try {
    config = JSON.parse(readFileSync(configPath, 'utf-8'))
  } catch (e) {}
}

/**
 * Regex para detectar tweets relevantes do nicho tech/AI/startups
 * Usa word boundaries (\b) para evitar falsos positivos
 * Ex: "ai" não deve fazer match com "jamais" ou "mais"
 */
const RELEVANT_PATTERNS = [
  // Tech/AI - palavras mais específicas
  /\b(artificial intelligence|machine learning|deep learning)\b/i,
  /\b(gpt|chatgpt|gpt-4|gpt-5)\b/i,
  /\b(llm|llms|large language model)\b/i,
  /\b(claude|anthropic|openai|gemini|midjourney|dall-e)\b/i,
  /\b(neural network|transformer|diffusion)\b/i,
  /\bchatbot\b/i,
  /\bautomation\b/i,
  /\bsaas\b/i,
  /\bsoftware\b/i,
  /\b(api|apis)\b/i,

  // Startups/Business
  /\b(startup|startups|start-up)\b/i,
  /\b(founder|founders|co-founder)\b/i,
  /\b(entrepreneur|entrepreneurship)\b/i,
  /\b(vc|venture capital|angel investor)\b/i,
  /\b(funding|seed round|series [a-d])\b/i,
  /\b(investor|investors)\b/i,
  /\byc\b/i, // Y Combinator
  /\b(revenue|mrr|arr)\b/i,
  /\b(growth hack|scale|bootstrap|bootstrapped)\b/i,
  /\bindie (hacker|maker|dev)\b/i,
  /\bshipped\b/i,

  // Crypto - palavras específicas
  /\b(crypto|cryptocurrency|cryptocurrencies)\b/i,
  /\b(bitcoin|btc)\b/i,
  /\b(ethereum|solana|polygon)\b/i,
  /\b(web3|defi|nft|nfts)\b/i,
  /\bblockchain\b/i,
  /\b(token|tokens|tokenomics)\b/i,
  /\b(altcoin|altcoins|memecoin)\b/i,
  /\b(bull market|bear market|bullish|bearish)\b/i,

  // Investimentos/Economia (NOVO!)
  /\b(stock|stocks|stock market)\b/i,
  /\b(s&p 500|s&p500|sp500|nasdaq|dow jones)\b/i,
  /\b(fed|federal reserve|interest rate|inflation)\b/i,
  /\b(gdp|recession|economy|economic)\b/i,
  /\b(investing|investment|portfolio)\b/i,
  /\b(trading|trader|traders)\b/i,
  /\b(market|markets|market cap)\b/i,
  /\b(earnings|revenue|profit|loss)\b/i,
  /\b(hedge fund|asset|assets)\b/i,
  /\b(macro|macroeconomics|fiscal|monetary)\b/i,
  /\b(bond|bonds|treasury|yield)\b/i,
  /\b(gold|silver|commodities|oil)\b/i,
  /\b(etf|etfs|index fund)\b/i,
  /\b(dividend|dividends|passive income)\b/i,
  /\b(valuation|pe ratio|price target)\b/i,

  // Dev/Vibe Coding
  /\b(coding|programming|developer|developers)\b/i,
  /\b(engineer|engineers|engineering)\b/i,
  /\b(react|nextjs|next\.js|vue|angular)\b/i,
  /\b(python|javascript|typescript|rust|golang)\b/i,
  /\b(deploy|deployment|devops)\b/i,
  /\b(github|gitlab|open source)\b/i,
  /\b(bug|bugs|debug|debugging)\b/i,
  /\b(vibe coding|vibecoding|cursor|copilot)\b/i,
  /\b(code editor|ide|vscode)\b/i,

  // Product
  /\b(product hunt|producthunt)\b/i,
  /\b(mvp|beta|launch|launched)\b/i,
  /\b(feature|features)\b/i,
  /\b(feedback|user feedback)\b/i,
  /\b(customer|customers|users)\b/i,

  // AI específico (cuidado com falsos positivos)
  /\bai\s+(tool|model|agent|assistant|generated|art)\b/i,
  /\b(gen ai|genai|generative ai)\b/i
]

/**
 * Verifica se um tweet é relevante para o nicho
 * Usa regex com word boundaries para evitar falsos positivos
 */
function isRelevantTweet(text) {
  return RELEVANT_PATTERNS.some(pattern => pattern.test(text))
}

/**
 * Busca tweets da página Creator Inspiration do X
 * Prioriza "Mais Respostas" (alta conversação = maior chance de reply do autor)
 *
 * NOTA: A página Creator Inspiration mostra tweets populares gerais.
 * Filtramos por keywords relevantes para manter foco no nicho tech/AI/startups.
 */
export async function findCreatorInspirationTweets(maxTweets = 8) {
  const browser = await getBrowser()
  const allTweets = []
  const seenUrls = new Set() // Evita duplicatas

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 900 })

    console.log('CreatorInspiration: acessando página...')

    await page.goto('https://x.com/i/jf/creators/inspiration/top_posts', {
      waitUntil: 'networkidle2',
      timeout: 30000
    })
    await randomDelay(2500, 3500)

    // Tenta clicar em diferentes tabs se disponíveis
    // A estrutura exata pode variar, então tentamos múltiplos seletores
    const tabSelectors = [
      'button[role="tab"]',
      '[data-testid="tab"]',
      'a[role="tab"]'
    ]

    for (const selector of tabSelectors) {
      try {
        const tabs = await page.$$(selector)
        if (tabs.length > 1) {
          // Clica no segundo tab (geralmente "Most replies")
          await tabs[1].click()
          await randomDelay(1500, 2000)
          console.log('CreatorInspiration: tab alternativa selecionada')
          break
        }
      } catch (e) {}
    }

    // Scroll para carregar mais tweets
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, 600))
      await randomDelay(1000, 1500)
    }

    // Extrai tweets da página
    const tweets = await page.evaluate(() => {
      const results = []
      const articles = document.querySelectorAll('article[data-testid="tweet"]')

      articles.forEach((article, index) => {
        if (index >= 20) return // Pega mais para depois filtrar

        try {
          const textEl = article.querySelector('[data-testid="tweetText"]')
          const text = textEl?.textContent?.trim() || ''

          // Pula já curtidos
          const alreadyLiked = !!article.querySelector('[data-testid="unlike"]')
          if (alreadyLiked) return

          // Autor
          const authorEl = article.querySelector('[data-testid="User-Name"] a')
          const authorHref = authorEl?.href || ''
          const authorMatch = authorHref.match(/x\.com\/(\w+)/)
          const author = authorMatch ? authorMatch[1] : ''

          // URL e data
          const timeEl = article.querySelector('time')
          const linkEl = timeEl?.closest('a')
          const url = linkEl?.href || ''
          const datetime = timeEl?.getAttribute('datetime') || ''

          // Métricas
          const getMetric = (testId) => {
            const el = article.querySelector(`[data-testid="${testId}"]`)
            const text = el?.textContent || '0'
            const match = text.match(/[\d,.]+[KMB]?/i)
            if (!match) return 0
            let num = match[0].replace(/,/g, '')
                if (num.includes('K')) num = parseFloat(num) * 1000
                else if (num.includes('M')) num = parseFloat(num) * 1000000
                else num = parseInt(num) || 0
                return num
              }

              if (text && url && author) {
                results.push({
                  author,
                  text: text.slice(0, 500),
                  url,
                  datetime,
                  likes: getMetric('like'),
                  replies: getMetric('reply'),
                  retweets: getMetric('retweet'),
                  source: 'creator_inspiration',
                  inspirationTab: 'replies', // Assumimos replies como padrão
                  inspirationCountry: 'global',
                  inspirationPriority: 1
                })
              }
            } catch (e) {}
          })

          return results
        })

        console.log(`CreatorInspiration: ${tweets.length} tweets brutos encontrados`)

        // Filtra por keywords relevantes (tech/AI/startups/crypto)
        // e remove duplicatas
        for (const tweet of tweets) {
          if (seenUrls.has(tweet.url)) continue
          seenUrls.add(tweet.url)

          // Verifica se é relevante para o nicho
          if (isRelevantTweet(tweet.text)) {
            allTweets.push(tweet)
          }
        }

        console.log(`CreatorInspiration: ${allTweets.length} tweets relevantes após filtro`)

    await safeClosePage(browser, page)

  } catch (error) {
    console.error('CreatorInspiration erro geral:', error.message)
  }

  // Se não encontrou tweets relevantes na página Creator Inspiration,
  // faz fallback para buscar tweets de contas tech conhecidas com alto engajamento
  if (allTweets.length === 0) {
    console.log('CreatorInspiration: nenhum tweet relevante, tentando fallback...')

    try {
      // Busca por queries relevantes no X (nicho: Tech/AI/Investimentos/Economia/Crypto/Vibe Coding)
      const queries = [
        'AI startup launched min_faves:50',
        'shipped product min_faves:100',
        'crypto bitcoin min_faves:100',
        'stock market trading min_faves:100',
        'fed interest rate min_faves:50',
        'economy inflation min_faves:50',
        'vibe coding cursor min_faves:30',
        'investing portfolio min_faves:50'
      ]

      const query = queries[Math.floor(Math.random() * queries.length)]
      console.log(`CreatorInspiration fallback: buscando "${query}"`)

      const page = await browser.newPage()
      await page.setViewport({ width: 1280, height: 800 })

      const searchUrl = `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`
      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 25000 })
      await randomDelay(2000, 3000)

      // Scroll para carregar mais
      await page.evaluate(() => window.scrollBy(0, 500))
      await randomDelay(1000, 1500)

      const fallbackTweets = await page.evaluate(() => {
        const results = []
        const articles = document.querySelectorAll('article[data-testid="tweet"]')

        articles.forEach((article, index) => {
          if (index >= 10) return

          try {
            const textEl = article.querySelector('[data-testid="tweetText"]')
            const text = textEl?.textContent?.trim() || ''

            const alreadyLiked = !!article.querySelector('[data-testid="unlike"]')
            if (alreadyLiked) return

            const authorEl = article.querySelector('[data-testid="User-Name"] a')
            const authorHref = authorEl?.href || ''
            const authorMatch = authorHref.match(/x\.com\/(\w+)/)
            const author = authorMatch ? authorMatch[1] : ''

            const timeEl = article.querySelector('time')
            const linkEl = timeEl?.closest('a')
            const url = linkEl?.href || ''
            const datetime = timeEl?.getAttribute('datetime') || ''

            const getMetric = (testId) => {
              const el = article.querySelector(`[data-testid="${testId}"]`)
              const text = el?.textContent || '0'
              const match = text.match(/[\d,.]+[KMB]?/i)
              if (!match) return 0
              let num = match[0].replace(/,/g, '')
              if (num.includes('K')) num = parseFloat(num) * 1000
              else if (num.includes('M')) num = parseFloat(num) * 1000000
              else num = parseInt(num) || 0
              return num
            }

            if (text && url && author) {
              results.push({
                author,
                text: text.slice(0, 500),
                url,
                datetime,
                likes: getMetric('like'),
                replies: getMetric('reply'),
                retweets: getMetric('retweet'),
                source: 'creator_inspiration',
                inspirationTab: 'search_fallback',
                inspirationCountry: 'global',
                inspirationPriority: 2
              })
            }
          } catch (e) {}
        })

        return results
      })

      await safeClosePage(browser, page)

      // Filtra por relevância
      for (const tweet of fallbackTweets) {
        if (!seenUrls.has(tweet.url) && isRelevantTweet(tweet.text)) {
          seenUrls.add(tweet.url)
          allTweets.push(tweet)
        }
      }

      console.log(`CreatorInspiration fallback: ${allTweets.length} tweets relevantes`)

    } catch (e) {
      console.log('CreatorInspiration fallback erro:', e.message)
    }
  }

  // Se ainda não encontrou nada, retorna vazio
  if (allTweets.length === 0) {
    console.log('CreatorInspiration: nenhum tweet encontrado')
    return []
  }

  console.log(`CreatorInspiration: retornando ${Math.min(allTweets.length, maxTweets)} tweets`)
  return allTweets.slice(0, maxTweets).map(t => ({ ...t, score: calculateScore(t, config) }))
}

/**
 * Verifica se o autor de um tweet costuma responder comentários
 * Retorna número de replies do autor nos primeiros 15 comentários
 * Usado para priorizar tweets onde há maior chance de 75x boost algorítmico
 */
export async function checkAuthorEngagement(tweetUrl) {
  const browser = await getBrowser()

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })

    await page.goto(tweetUrl, { waitUntil: 'networkidle2', timeout: 25000 })
    await randomDelay(2000, 3000)

    // Scroll para carregar replies
    for (let i = 0; i < 2; i++) {
      await page.evaluate(() => window.scrollBy(0, 600))
      await randomDelay(800, 1200)
    }

    // Conta replies do autor original
    const authorReplies = await page.evaluate(() => {
      // Pega o autor do tweet principal
      const allTweets = document.querySelectorAll('article[data-testid="tweet"]')
      if (allTweets.length === 0) return 0

      const mainTweet = allTweets[0]
      const authorEl = mainTweet?.querySelector('[data-testid="User-Name"] a')
      const authorHref = authorEl?.href || ''
      const authorMatch = authorHref.match(/x\.com\/(\w+)/)
      const originalAuthor = authorMatch ? authorMatch[1].toLowerCase() : ''

      if (!originalAuthor) return 0

      // Conta quantos replies são do autor original
      let count = 0

      allTweets.forEach((tweet, i) => {
        if (i === 0) return // Pula o tweet principal
        if (i > 15) return // Só analisa primeiros 15 replies

        const replyAuthorEl = tweet.querySelector('[data-testid="User-Name"] a')
        const replyHref = replyAuthorEl?.href || ''
        const replyMatch = replyHref.match(/x\.com\/(\w+)/)
        const replyAuthor = replyMatch ? replyMatch[1].toLowerCase() : ''

        if (replyAuthor === originalAuthor) count++
      })

      return count
    })

    await safeClosePage(browser, page)
    console.log(`AuthorEngagement para ${tweetUrl.slice(-20)}: ${authorReplies} replies do autor`)
    return authorReplies

  } catch (e) {
    console.log('checkAuthorEngagement erro:', e.message)
    return 0
  }
}

export default {
  discoverTweets,
  findTweetsFromTimeline,
  findTrendingTweets,
  findHackerNewsTweets,
  findCreatorInspirationTweets,
  findTweetsFromKeywordSearch,
  findTweetsFromMonitoredAccounts,
  findHighEngagementTweets,
  findTargetingTweets,
  checkAuthorEngagement,
  reloadConfig
}
