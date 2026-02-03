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
    // Para outras fontes, muitos replies = competição alta = penaliza
    if (tweet.replies > (filters.max_replies || 100)) {
      score -= 30
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
 * @param {Object} options - Opcoes de discovery
 * @param {boolean} options.checkEngagement - Se deve verificar engajamento do autor (mais lento)
 * @returns {Promise<Array>} - Tweets ordenados por score
 */
export async function discoverTweets(maxTweets = 10, options = {}) {
  console.log('\n=== DISCOVERY: Buscando tweets de 4 fontes ===')

  // Verifica se Creator Inspiration está habilitado na config
  const discoveryConfig = config.discovery || {}
  const useCreatorInspiration = discoveryConfig.explore_creator_inspiration !== false

  // Busca das 4 fontes em paralelo
  const promises = [
    findTweetsFromTimeline(5),
    findTrendingTweets(5),
    findHackerNewsTweets(3)
  ]

  // Adiciona Creator Inspiration se habilitado
  if (useCreatorInspiration) {
    promises.push(findCreatorInspirationTweets(8))
  }

  const results = await Promise.allSettled(promises)

  // Coleta resultados
  const allTweets = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value || [])

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
  checkAuthorEngagement,
  reloadConfig
}
