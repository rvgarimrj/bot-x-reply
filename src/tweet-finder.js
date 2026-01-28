import puppeteer from 'puppeteer-core'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { getRepliedTweetUrls } from './knowledge.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Carrega configuração de contas
const configPath = join(__dirname, '../config/accounts.json')
let config = {}
try {
  config = JSON.parse(readFileSync(configPath, 'utf-8'))
} catch (e) {
  console.warn('Config de contas não encontrada')
}

// Carrega username do perfil
const profilePath = join(__dirname, '../config/profile.json')
let myUsername = ''
try {
  const profile = JSON.parse(readFileSync(profilePath, 'utf-8'))
  myUsername = profile.x_username?.toLowerCase() || ''
} catch (e) {
  console.warn('Config de perfil não encontrada')
}

/**
 * Conecta ao Chrome na porta 9222
 */
async function getBrowser() {
  try {
    const browser = await puppeteer.connect({
      browserURL: 'http://127.0.0.1:9222'
    })
    return browser
  } catch {
    throw new Error('Chrome não está rodando na porta 9222. Execute: ./scripts/start-chrome.sh')
  }
}

/**
 * Delay aleatório para parecer humano
 */
function randomDelay(min, max) {
  return new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min))
}

/**
 * Fecha aba de forma segura (não fecha se for a última)
 */
async function safeClosePage(browser, page) {
  try {
    const pages = await browser.pages()
    if (pages.length > 1) {
      await page.close()
    }
    // Se for única aba, não fecha nada (deixa no X)
  } catch (e) {
    // Ignora erros
  }
}

/**
 * Extrai tweets de um perfil
 */
async function extractTweetsFromProfile(page, username) {
  console.log(`📍 Buscando tweets de @${username}...`)

  await page.goto(`https://x.com/${username}`, { waitUntil: 'networkidle2', timeout: 30000 })
  await randomDelay(2000, 4000)

  // Scroll para carregar mais tweets
  await page.evaluate(() => window.scrollBy(0, 500))
  await randomDelay(1500, 2500)

  // Extrai tweets
  const tweets = await page.evaluate((user) => {
    const results = []
    const articles = document.querySelectorAll('article[data-testid="tweet"]')

    articles.forEach((article, index) => {
      if (index >= 5) return // Max 5 tweets por perfil

      try {
        // Texto do tweet
        const textEl = article.querySelector('[data-testid="tweetText"]')
        const text = textEl?.textContent?.trim() || ''

        // Ignora retweets
        const isRetweet = article.querySelector('[data-testid="socialContext"]')?.textContent?.includes('reposted')
        if (isRetweet) return

        // Verifica se já demos like (indica que já interagimos)
        const alreadyLiked = !!article.querySelector('[data-testid="unlike"]')
        if (alreadyLiked) return // Pula tweets que já curtimos

        // URL do tweet
        const timeEl = article.querySelector('time')
        const linkEl = timeEl?.closest('a')
        const url = linkEl?.href || ''

        // Data
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

        const likes = getMetric('like')
        const replies = getMetric('reply')
        const retweets = getMetric('retweet')

        if (text && url) {
          results.push({
            author: user,
            text: text.slice(0, 500),
            url,
            datetime,
            likes,
            replies,
            retweets
          })
        }
      } catch (e) {
        // Ignora erros de extração
      }
    })

    return results
  }, username)

  return tweets
}

/**
 * Calcula score de um tweet para priorização
 */
function calculateTweetScore(tweet, config) {
  let score = 0
  const filters = config.filters || {}

  // Engajamento
  score += Math.min(tweet.likes, 10000) / 100 // Max 100 pontos por likes
  score += Math.min(tweet.retweets, 1000) / 10 // Max 100 pontos por RTs

  // Penaliza se tem muitos replies (seu reply vai se perder)
  if (tweet.replies > (filters.max_replies || 50)) {
    score -= 30
  }

  // Bonus se é recente
  if (tweet.datetime) {
    const ageHours = (Date.now() - new Date(tweet.datetime).getTime()) / 3600000
    if (ageHours < 1) score += 50
    else if (ageHours < 2) score += 40
    else if (ageHours < 4) score += 20
    else if (ageHours > (filters.max_age_hours || 4)) score -= 50
  }

  // Bonus se tem pergunta (mais fácil de responder)
  if (tweet.text.includes('?')) {
    score += 20
  }

  // Bonus se é opinião (mais fácil de engajar)
  const opinionWords = /\b(think|believe|should|must|need|wrong|right|best|worst|love|hate|acho|acredito|deveria|precisa)\b/i
  if (opinionWords.test(tweet.text)) {
    score += 15
  }

  // Prioridade da conta
  const account = config.priority_accounts?.find(a => a.username.toLowerCase() === tweet.author.toLowerCase())
  if (account?.priority === 'high') score += 30
  else if (account?.priority === 'medium') score += 15

  return Math.round(score)
}

/**
 * Busca tweets de todas as contas configuradas
 */
export async function findTweetsToEngage(maxTweets = 5) {
  const browser = await getBrowser()

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })

    const allTweets = []
    const accounts = config.priority_accounts || []

    // Busca em cada conta (máximo 5 para não demorar muito)
    for (const account of accounts.slice(0, 5)) {
      try {
        const tweets = await extractTweetsFromProfile(page, account.username)
        allTweets.push(...tweets)
        await randomDelay(2000, 4000) // Delay entre perfis
      } catch (e) {
        console.error(`Erro ao buscar @${account.username}:`, e.message)
      }
    }

    await safeClosePage(browser, page)

    // Filtra e ordena por score
    const filters = config.filters || {}
    const filtered = allTweets.filter(t => {
      // Filtro de likes mínimo
      if (t.likes < (filters.min_likes || 100)) return false
      // Filtro de idade
      if (t.datetime) {
        const ageHours = (Date.now() - new Date(t.datetime).getTime()) / 3600000
        if (ageHours > (filters.max_age_hours || 4)) return false
      }
      return true
    })

    // Calcula score e ordena
    const scored = filtered.map(t => ({
      ...t,
      score: calculateTweetScore(t, config)
    }))

    scored.sort((a, b) => b.score - a.score)

    console.log(`✅ Encontrados ${scored.length} tweets relevantes`)

    return scored.slice(0, maxTweets)

  } catch (error) {
    console.error('Erro na busca:', error.message)
    throw error
  }
}

/**
 * Busca tweets da timeline
 */
export async function findTweetsFromTimeline(maxTweets = 5) {
  const browser = await getBrowser()

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })

    console.log('📍 Buscando tweets da timeline...')
    await page.goto('https://x.com/home', { waitUntil: 'networkidle2', timeout: 30000 })
    await randomDelay(2000, 4000)

    // Scroll para carregar mais
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, 600))
      await randomDelay(1500, 2500)
    }

    // Extrai tweets
    const tweets = await page.evaluate(() => {
      const results = []
      const articles = document.querySelectorAll('article[data-testid="tweet"]')

      articles.forEach((article, index) => {
        if (index >= 15) return

        try {
          const textEl = article.querySelector('[data-testid="tweetText"]')
          const text = textEl?.textContent?.trim() || ''

          // Verifica se já demos like (indica que já interagimos)
          const alreadyLiked = !!article.querySelector('[data-testid="unlike"]')
          if (alreadyLiked) return // Pula tweets que já curtimos

          // Autor
          const authorEl = article.querySelector('[data-testid="User-Name"] a')
          const authorHref = authorEl?.href || ''
          const authorMatch = authorHref.match(/x\.com\/(\w+)/)
          const author = authorMatch ? authorMatch[1] : ''

          // URL
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
              retweets: getMetric('retweet')
            })
          }
        } catch (e) {}
      })

      return results
    })

    await safeClosePage(browser, page)

    // Filtra e ordena
    const scored = tweets
      .filter(t => t.likes >= (config.filters?.min_likes || 50))
      .map(t => ({ ...t, score: calculateTweetScore(t, config) }))
      .sort((a, b) => b.score - a.score)

    console.log(`✅ Encontrados ${scored.length} tweets na timeline`)

    return scored.slice(0, maxTweets)

  } catch (error) {
    console.error('Erro na busca:', error.message)
    throw error
  }
}

/**
 * Verifica se já respondemos a um tweet específico
 * Visita a página do tweet e procura por reply do nosso username
 */
async function hasMyReply(page, tweetUrl) {
  if (!myUsername) return false

  try {
    await page.goto(tweetUrl, { waitUntil: 'networkidle2', timeout: 20000 })
    await randomDelay(1500, 2500)

    // Scroll para carregar replies
    await page.evaluate(() => window.scrollBy(0, 400))
    await randomDelay(1000, 1500)

    // Procura por nosso username nos replies
    const hasReply = await page.evaluate((username) => {
      // Procura links para o nosso perfil na seção de replies
      const userLinks = document.querySelectorAll(`a[href="/${username}"]`)
      for (const link of userLinks) {
        // Verifica se está dentro de um tweet (reply)
        const article = link.closest('article')
        if (article) {
          return true
        }
      }
      return false
    }, myUsername)

    return hasReply
  } catch (e) {
    console.log(`⚠️ Erro ao verificar reply em ${tweetUrl}: ${e.message}`)
    return false
  }
}

/**
 * Busca híbrida: contas prioritárias + timeline
 */
export async function findBestTweets(maxTweets = 5) {
  const browser = await getBrowser()

  try {
    // Busca das duas fontes em paralelo
    const [fromAccounts, fromTimeline] = await Promise.all([
      findTweetsToEngage(5).catch(() => []),
      findTweetsFromTimeline(5).catch(() => [])
    ])

    // Combina e remove duplicatas
    const allTweets = [...fromAccounts, ...fromTimeline]
    const unique = allTweets.filter((t, i) =>
      allTweets.findIndex(x => x.url === t.url) === i
    )

    // Filtra tweets que já respondemos (base de conhecimento)
    const repliedUrls = getRepliedTweetUrls()
    let candidates = unique.filter(t => !repliedUrls.includes(t.url))

    if (candidates.length < unique.length) {
      console.log(`🔄 Filtrados ${unique.length - candidates.length} tweets da base de conhecimento`)
    }

    // Reordena pelo score
    candidates.sort((a, b) => b.score - a.score)

    // Pega os top candidatos e verifica se já respondemos no X
    const topCandidates = candidates.slice(0, maxTweets + 3) // Pega alguns extras
    const verified = []

    if (topCandidates.length > 0 && myUsername) {
      console.log(`🔍 Verificando ${topCandidates.length} tweets para replies existentes...`)
      const page = await browser.newPage()
      await page.setViewport({ width: 1280, height: 800 })

      for (const tweet of topCandidates) {
        if (verified.length >= maxTweets) break

        const alreadyReplied = await hasMyReply(page, tweet.url)
        if (alreadyReplied) {
          console.log(`⏭️ Pulando @${tweet.author} - já tem seu reply`)
        } else {
          verified.push(tweet)
        }
      }

      await safeClosePage(browser, page)
      console.log(`✅ ${verified.length} tweets verificados sem reply anterior`)
    } else {
      // Se não tem username configurado, retorna sem verificação
      return candidates.slice(0, maxTweets)
    }

    return verified.slice(0, maxTweets)

  } catch (error) {
    console.error('Erro na busca híbrida:', error.message)
    throw error
  }
}

/**
 * Formata tweet para exibição
 */
export function formatTweetForDisplay(tweet, index) {
  const ageStr = tweet.datetime
    ? getTimeAgo(new Date(tweet.datetime))
    : 'recente'

  return `<b>${index}.</b> @${tweet.author}\n` +
    `"${tweet.text.slice(0, 100)}${tweet.text.length > 100 ? '...' : ''}"\n` +
    `⏰ ${ageStr} | ❤️ ${formatNumber(tweet.likes)} | 💬 ${formatNumber(tweet.replies)} | 🎯 Score: ${tweet.score}`
}

/**
 * Formata tweet com visual melhorado (card style)
 */
export function formatTweetCard(tweet, index, isBest = false) {
  const ageStr = tweet.datetime
    ? getTimeAgo(new Date(tweet.datetime))
    : 'recente'

  const star = isBest ? '⭐ ' : ''
  const rec = isBest ? '\n🏆 <b>RECOMENDADO</b>' : ''
  const separator = '━━━━━━━━━━━━━━━━━━━━'

  return `${separator}\n` +
    `${star}<b>${index}. @${tweet.author}</b>${rec}\n\n` +
    `💬 "${tweet.text.slice(0, 120)}${tweet.text.length > 120 ? '...' : ''}"\n\n` +
    `⏰ ${ageStr}  •  ❤️ ${formatNumber(tweet.likes)}  •  💬 ${formatNumber(tweet.replies)}\n` +
    `🎯 Score: <b>${tweet.score}</b>` +
    (tweet.url ? `\n🔗 <a href="${tweet.url}">Abrir tweet</a>` : '')
}

function getTimeAgo(date) {
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000)
  if (minutes < 60) return `${minutes}min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M'
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K'
  return num.toString()
}

export default {
  findTweetsToEngage,
  findTweetsFromTimeline,
  findBestTweets,
  formatTweetForDisplay
}
