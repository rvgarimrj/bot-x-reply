#!/usr/bin/env node
import puppeteer from 'puppeteer-core'

async function replyToPaulGraham() {
  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9222',
    protocolTimeout: 120000
  })

  const page = await browser.newPage()
  await page.setDefaultTimeout(60000)

  // Vai para notificações
  console.log('Acessando notificações...')
  await page.goto('https://x.com/notifications', { waitUntil: 'networkidle2' })
  await new Promise(r => setTimeout(r, 3000))

  // Procura o tweet do Paul Graham
  const paulTweet = await page.evaluate(() => {
    const articles = document.querySelectorAll('article')
    for (const article of articles) {
      const text = article.innerText || ''
      if (text.includes('paulg') && text.includes('Walking') && text.includes('4 miles')) {
        // Encontra o link do tweet
        const links = article.querySelectorAll('a[href*="/status/"]')
        for (const link of links) {
          if (link.href.includes('paulg')) {
            return link.href
          }
        }
      }
    }
    return null
  })

  if (!paulTweet) {
    console.log('Tweet do Paul Graham não encontrado nas notificações')
    await page.close()
    return
  }

  console.log('Encontrado:', paulTweet)

  // Navega para o tweet
  await page.goto(paulTweet, { waitUntil: 'networkidle2' })
  await new Promise(r => setTimeout(r, 2000))

  // Curte
  try {
    await page.click('[data-testid="like"]')
    await new Promise(r => setTimeout(r, 1000))
    console.log('✅ Curtido!')
  } catch (e) {
    console.log('Já curtido ou erro:', e.message)
  }

  // Clica em reply
  try {
    await page.click('[data-testid="reply"]')
    await new Promise(r => setTimeout(r, 2000))
  } catch (e) {
    console.log('Erro ao abrir reply:', e.message)
  }

  // Digita resposta
  const replyText = "that's amazing at her age 👏"

  // Clica no campo de texto
  await page.click('[data-testid="tweetTextarea_0"]')
  await new Promise(r => setTimeout(r, 500))

  // Digita usando keyboard
  await page.keyboard.type(replyText, { delay: 50 })
  await new Promise(r => setTimeout(r, 1000))

  // Posta
  try {
    await page.click('[data-testid="tweetButton"]')
    await new Promise(r => setTimeout(r, 3000))
    console.log('✅ Reply postado para @paulg: "' + replyText + '"')
  } catch (e) {
    console.log('Erro ao postar:', e.message)
  }

  await page.close()
}

replyToPaulGraham().catch(e => console.error('Erro:', e.message))
