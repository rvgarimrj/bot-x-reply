#!/usr/bin/env node
import puppeteer from 'puppeteer-core'
import { readFileSync } from 'fs'

async function debug() {
  const state = JSON.parse(readFileSync('data/reply-to-reply-state.json', 'utf-8'))
  console.log('IDs já respondidos:', state.repliedTo.length)

  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9222',
    protocolTimeout: 120000
  })

  const page = await browser.newPage()
  await page.goto('https://x.com/notifications', { waitUntil: 'networkidle2' })
  await new Promise(r => setTimeout(r, 3000))

  const items = await page.evaluate(() => {
    const results = []
    const articles = document.querySelectorAll('article[data-testid="tweet"]')

    for (const article of articles) {
      const textEl = article.querySelector('[data-testid="tweetText"]')
      const text = textEl?.innerText?.slice(0, 50) || ''
      const authorLink = article.querySelector('a[href^="/"][tabindex="-1"]')
      const author = authorLink?.href?.split('/')[3] || ''

      const allLinks = article.querySelectorAll('a[href*="/status/"]')
      let tweetUrl = ''
      let tweetId = ''

      for (const link of allLinks) {
        const href = link.href || ''
        if (author && href.toLowerCase().includes('/' + author.toLowerCase() + '/status/')) {
          tweetUrl = href
          tweetId = href.split('/').pop()
          break
        }
      }

      if (!tweetUrl && allLinks.length > 0) {
        const lastLink = allLinks[allLinks.length - 1]
        tweetUrl = lastLink.href || ''
        tweetId = tweetUrl.split('/').pop()
      }

      if (author && text && tweetId) {
        results.push({ author, text, tweetId })
      }
    }
    return results.slice(0, 8)
  })

  console.log('\nEncontrados', items.length, 'itens nas notificações:\n')

  for (const item of items) {
    const jaRespondido = state.repliedTo.includes(item.tweetId)
    const status = jaRespondido ? '❌ JÁ RESPONDIDO' : '✅ NOVO'
    console.log(`${status} | @${item.author} | ID: ${item.tweetId}`)
    console.log(`   "${item.text}..."`)
    console.log('')
  }

  await page.close()
  process.exit(0)
}

debug().catch(e => {
  console.error('Erro:', e.message)
  process.exit(1)
})
