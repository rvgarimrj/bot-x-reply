#!/usr/bin/env node

/**
 * Collect Metrics - Coleta métricas de engajamento dos replies postados
 *
 * Verifica os replies postados e atualiza:
 * - Likes recebidos
 * - Replies recebidos (especialmente do autor original!)
 * - Novos follows
 *
 * Isso alimenta o Learning System para auto-otimização.
 *
 * Uso:
 *   node scripts/collect-metrics.js           # Coleta últimos 20 replies
 *   node scripts/collect-metrics.js --all     # Coleta todos sem métricas
 */

import 'dotenv/config'
import puppeteer from 'puppeteer-core'
import {
  loadKnowledge,
  saveKnowledge,
  updateReplyMetrics,
  updateSourceMetrics
} from '../src/knowledge.js'

const COLORS = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
}

function log(color, msg) {
  console.log(`${COLORS[color]}${msg}${COLORS.reset}`)
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
    throw new Error('Chrome não está rodando na porta 9222')
  }
}

/**
 * Delay aleatório
 */
function randomDelay(min, max) {
  return new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min))
}

/**
 * Busca métricas de um reply específico
 */
async function fetchReplyMetrics(browser, replyData) {
  const page = await browser.newPage()

  try {
    // Navega para o tweet original
    await page.goto(replyData.tweetUrl, { waitUntil: 'networkidle2', timeout: 30000 })
    await randomDelay(2000, 3000)

    // Scroll para carregar replies
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, 500))
      await randomDelay(800, 1200)
    }

    // Busca nosso reply e suas métricas
    const metrics = await page.evaluate((ourReplyText) => {
      const articles = document.querySelectorAll('article[data-testid="tweet"]')
      let ourReply = null
      let authorReplied = false

      // Encontra o autor do tweet principal
      const mainTweet = articles[0]
      const authorEl = mainTweet?.querySelector('[data-testid="User-Name"] a')
      const authorHref = authorEl?.href || ''
      const authorMatch = authorHref.match(/x\.com\/(\w+)/)
      const originalAuthor = authorMatch ? authorMatch[1].toLowerCase() : ''

      // Procura nosso reply
      for (const article of articles) {
        const textEl = article.querySelector('[data-testid="tweetText"]')
        const text = textEl?.textContent?.trim() || ''

        // Verifica se é nosso reply (match parcial)
        if (ourReplyText && text.includes(ourReplyText.slice(0, 30))) {
          // Encontrou nosso reply - pega métricas
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

          ourReply = {
            likes: getMetric('like'),
            replies: getMetric('reply'),
            retweets: getMetric('retweet')
          }

          // Verifica se o autor respondeu ao nosso reply
          // (procura reply do autor logo abaixo do nosso)
          const ourIndex = Array.from(articles).indexOf(article)
          for (let i = ourIndex + 1; i < Math.min(ourIndex + 5, articles.length); i++) {
            const nextArticle = articles[i]
            const nextAuthorEl = nextArticle.querySelector('[data-testid="User-Name"] a')
            const nextHref = nextAuthorEl?.href || ''
            const nextMatch = nextHref.match(/x\.com\/(\w+)/)
            const nextAuthor = nextMatch ? nextMatch[1].toLowerCase() : ''

            if (nextAuthor === originalAuthor) {
              // Verifica se está respondendo a nós (thread context)
              const replyContext = nextArticle.querySelector('[data-testid="tweet"] a[href*="/status/"]')
              authorReplied = true
              break
            }
          }

          break
        }
      }

      return { ourReply, authorReplied, originalAuthor }
    }, replyData.replyText)

    await page.close()
    return metrics

  } catch (e) {
    console.error(`Erro ao buscar métricas: ${e.message}`)
    try { await page.close() } catch {}
    return null
  }
}

/**
 * Função principal
 */
async function main() {
  const args = process.argv.slice(2)
  const collectAll = args.includes('--all')

  console.log('\n' + '═'.repeat(60))
  console.log('  📊 COLLECT METRICS - Coleta de Engajamento')
  console.log('═'.repeat(60) + '\n')

  // Carrega knowledge base
  const knowledge = loadKnowledge()
  const replies = knowledge.replies || []

  // Filtra replies que precisam de métricas
  let toCollect = replies.filter(r => {
    // Sem métricas ainda
    if (r.metrics?.likes === null || r.metrics?.likes === undefined) return true
    // Ou métricas antigas (mais de 24h)
    if (r.metrics?.checkedAt) {
      const age = Date.now() - new Date(r.metrics.checkedAt).getTime()
      const hours = age / 3600000
      if (hours > 24 && !collectAll) return true
    }
    return false
  })

  // Limita para não sobrecarregar
  if (!collectAll) {
    toCollect = toCollect.slice(0, 20)
  }

  console.log(`Replies totais: ${replies.length}`)
  console.log(`Replies para coletar métricas: ${toCollect.length}`)

  if (toCollect.length === 0) {
    log('green', '✅ Todos os replies já têm métricas atualizadas!')
    return
  }

  // Conecta ao Chrome
  let browser
  try {
    browser = await getBrowser()
    log('green', '✅ Conectado ao Chrome')
  } catch (e) {
    log('red', `❌ ${e.message}`)
    log('yellow', '⚠️  Inicie o Chrome com: node scripts/start-chrome.js')
    return
  }

  // Coleta métricas
  let collected = 0
  let authorReplies = 0
  let totalLikes = 0

  for (const reply of toCollect) {
    console.log(`\nColetando: @${reply.tweetAuthor} - "${reply.replyText?.slice(0, 30)}..."`)

    const metrics = await fetchReplyMetrics(browser, reply)

    if (metrics?.ourReply) {
      // Atualiza métricas do reply
      updateReplyMetrics(reply.id, {
        likes: metrics.ourReply.likes,
        replies: metrics.ourReply.replies,
        authorReplied: metrics.authorReplied
      })

      // Atualiza métricas da fonte (Learning System)
      if (reply.source) {
        updateSourceMetrics(reply.source, {
          likes: metrics.ourReply.likes,
          authorReplied: metrics.authorReplied
        })
      }

      collected++
      totalLikes += metrics.ourReply.likes
      if (metrics.authorReplied) {
        authorReplies++
        log('green', `  🎯 AUTOR RESPONDEU! (75x boost)`)
      }
      log('blue', `  Likes: ${metrics.ourReply.likes} | Replies: ${metrics.ourReply.replies}`)

    } else {
      log('yellow', `  ⚠️ Reply não encontrado na thread`)
    }

    // Delay entre requests
    await randomDelay(3000, 5000)
  }

  // Resumo
  console.log('\n' + '═'.repeat(60))
  console.log('  📋 RESUMO DA COLETA')
  console.log('═'.repeat(60))
  console.log(`\n  Métricas coletadas: ${collected}/${toCollect.length}`)
  console.log(`  Total de likes: ${totalLikes}`)
  console.log(`  Author replies (75x boost!): ${authorReplies}`)
  console.log(`  Taxa de author reply: ${collected > 0 ? Math.round(authorReplies / collected * 100) : 0}%`)

  if (authorReplies > 0) {
    log('green', `\n  🎉 ${authorReplies} replies receberam resposta do autor!`)
    log('green', '  Isso significa 75x mais visibilidade no algoritmo!')
  }

  console.log('\n' + '═'.repeat(60) + '\n')
}

main().catch(e => {
  console.error('Erro:', e)
  process.exit(1)
})
