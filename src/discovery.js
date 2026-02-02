import puppeteer from 'puppeteer-core'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { getRepliedTweetUrls } from './knowledge.js'
import { hasRepliedToday, canEngageAccount } from './finder.js'

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
 */
function calculateScore(tweet, config) {
  let score = 0
  const filters = config.filters || {}

  // Engajamento
  score += Math.min(tweet.likes, 10000) / 100
  score += Math.min(tweet.retweets, 1000) / 10

  // Penaliza muitos replies
  if (tweet.replies > (filters.max_replies || 100)) {
    score -= 30
  }

  // Bonus se recente
  if (tweet.datetime) {
    const ageHours = (Date.now() - new Date(tweet.datetime).getTime()) / 3600000
    if (ageHours < 1) score += 50
    else if (ageHours < 2) score += 40
    else if (ageHours < 4) score += 20
    else if (ageHours > (filters.max_age_hours || 6)) score -= 50
  }

  // Bonus pergunta
  if (tweet.text.includes('?')) score += 20

  // Bonus opiniao
  const opinionWords = /\b(think|believe|should|must|need|wrong|right|best|worst|love|hate|acho|acredito|deveria|precisa)\b/i
  if (opinionWords.test(tweet.text)) score += 15

  // Prioridade da conta
  const account = config.priority_accounts?.find(a => a.username.toLowerCase() === tweet.author?.toLowerCase())
  if (account?.priority === 'high') score += 30
  else if (account?.priority === 'medium') score += 15

  // Bonus para trending topics
  if (tweet.source === 'trending') score += 10

  // Bonus para HN (tech relevance)
  if (tweet.source === 'hackernews') score += 15

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

/**
 * Descobre tweets de multiplas fontes
 * @param {number} maxTweets - Maximo de tweets a retornar
 * @returns {Promise<Array>} - Tweets ordenados por score
 */
export async function discoverTweets(maxTweets = 10) {
  console.log('\n=== DISCOVERY: Buscando tweets de 3 fontes ===')

  // Busca das 3 fontes em paralelo
  const [timeline, trending, hn] = await Promise.allSettled([
    findTweetsFromTimeline(5),
    findTrendingTweets(5),
    findHackerNewsTweets(3)
  ])

  // Coleta resultados
  const allTweets = [
    ...(timeline.status === 'fulfilled' ? timeline.value : []),
    ...(trending.status === 'fulfilled' ? trending.value : []),
    ...(hn.status === 'fulfilled' ? hn.value : [])
  ]

  console.log(`\nTotal bruto: ${allTweets.length} tweets`)

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
    if (t.replies > (filters.max_replies || 200)) return false
    if (t.datetime) {
      const ageHours = (Date.now() - new Date(t.datetime).getTime()) / 3600000
      if (ageHours > (filters.max_age_hours || 12)) return false
    }
    return true
  })
  console.log(`Apos filtros config: ${candidates.length} tweets`)

  // Ordena por score
  candidates.sort((a, b) => b.score - a.score)

  console.log(`=== DISCOVERY: Retornando top ${Math.min(candidates.length, maxTweets)} ===\n`)

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

export default {
  discoverTweets,
  findTweetsFromTimeline,
  findTrendingTweets,
  findHackerNewsTweets,
  reloadConfig
}
