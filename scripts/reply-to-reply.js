#!/usr/bin/env node

/**
 * Reply-to-Reply - Responde replies nos nossos tweets
 *
 * Monitora notificações e threads para encontrar pessoas
 * que responderam aos nossos replies, e responde de volta
 * com tom gentil, humorístico e usando emojis.
 *
 * Uso:
 *   node scripts/reply-to-reply.js              # Verifica e responde
 *   node scripts/reply-to-reply.js --dry-run    # Só mostra, não posta
 *   node scripts/reply-to-reply.js --daemon     # Roda em loop contínuo
 */

import 'dotenv/config'
import Anthropic from '@anthropic-ai/sdk'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import puppeteer from 'puppeteer-core'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '..', 'data')
const KNOWLEDGE_PATH = join(DATA_DIR, 'knowledge.json')
const REPLY_TO_REPLY_STATE = join(DATA_DIR, 'reply-to-reply-state.json')

const anthropic = new Anthropic()

// Configuração
const CONFIG = {
  checkInterval: 15 * 60 * 1000, // 15 minutos
  maxRepliesPerCycle: 5,
  maxRepliesPerThread: 2, // MÁXIMO 2 replies por thread, depois o usuário assume
  myUsername: 'gabrielabiramia',
  chromePort: 9222
}

// Estado
let state = {
  repliedTo: new Set(), // IDs de replies que já respondemos
  threadReplyCounts: {}, // threadId -> número de replies que fizemos nessa thread
  lastCheck: null
}

/**
 * Carrega estado persistente
 */
function loadState() {
  try {
    if (existsSync(REPLY_TO_REPLY_STATE)) {
      const data = JSON.parse(readFileSync(REPLY_TO_REPLY_STATE, 'utf-8'))
      state.repliedTo = new Set(data.repliedTo || [])
      state.threadReplyCounts = data.threadReplyCounts || {}
      state.lastCheck = data.lastCheck
    }
  } catch (e) {
    console.warn('Erro ao carregar estado:', e.message)
  }
}

/**
 * Salva estado persistente
 */
function saveState() {
  try {
    writeFileSync(REPLY_TO_REPLY_STATE, JSON.stringify({
      repliedTo: [...state.repliedTo],
      threadReplyCounts: state.threadReplyCounts,
      lastCheck: new Date().toISOString()
    }, null, 2))
  } catch (e) {
    console.warn('Erro ao salvar estado:', e.message)
  }
}

/**
 * Gera ID único para pessoa+thread
 * Limita replies POR PESSOA dentro de cada thread
 */
function getPersonThreadKey(author, tweetUrl) {
  // Extrai o ID do tweet original da URL
  const match = tweetUrl.match(/status\/(\d+)/)
  const threadId = match ? match[1] : tweetUrl
  return `${author.toLowerCase()}_${threadId}`
}

/**
 * Verifica se já atingiu limite de replies para essa pessoa nessa thread
 */
function canReplyToPerson(author, tweetUrl) {
  const key = getPersonThreadKey(author, tweetUrl)
  const count = state.threadReplyCounts[key] || 0
  return count < CONFIG.maxRepliesPerThread
}

/**
 * Incrementa contador de replies para essa pessoa
 */
function incrementPersonReplyCount(author, tweetUrl) {
  const key = getPersonThreadKey(author, tweetUrl)
  state.threadReplyCounts[key] = (state.threadReplyCounts[key] || 0) + 1
  return state.threadReplyCounts[key]
}

/**
 * Retorna quantas vezes já respondemos essa pessoa nessa thread
 */
function getPersonReplyCount(author, tweetUrl) {
  const key = getPersonThreadKey(author, tweetUrl)
  return state.threadReplyCounts[key] || 0
}

/**
 * Conecta ao Chrome
 */
async function connectChrome() {
  try {
    const browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${CONFIG.chromePort}`,
      protocolTimeout: 120000
    })
    return browser
  } catch (e) {
    console.error('Erro ao conectar Chrome:', e.message)
    return null
  }
}

/**
 * Busca replies aos nossos tweets via notificações
 */
async function findRepliesToOurReplies(browser) {
  const replies = []

  try {
    const page = await browser.newPage()
    await page.setDefaultTimeout(60000)

    // Vai para notificações
    console.log('Acessando notificações...')
    await page.goto('https://x.com/notifications', { waitUntil: 'networkidle2' })
    await new Promise(r => setTimeout(r, 3000))

    // Busca notificações de reply
    const notifications = await page.evaluate(() => {
      const items = []
      const articles = document.querySelectorAll('article[data-testid="tweet"]')

      for (const article of articles) {
        try {
          // Pega o texto do tweet
          const textEl = article.querySelector('[data-testid="tweetText"]')
          const text = textEl?.innerText || ''

          // Pega o autor - procura link do perfil com @username
          const authorLink = article.querySelector('a[href^="/"][tabindex="-1"]')
          const author = authorLink?.href?.split('/')[3] || ''

          // CORRIGIDO: Pega o link do tweet DO AUTOR (não do tweet pai)
          // Procura todos os links com /status/ e pega o que pertence ao autor
          let tweetLink = ''
          let tweetId = ''

          const allLinks = article.querySelectorAll('a[href*="/status/"]')
          for (const link of allLinks) {
            const href = link.href || ''
            // Verifica se o link pertence ao autor identificado
            if (author && href.toLowerCase().includes(`/${author.toLowerCase()}/status/`)) {
              tweetLink = href
              tweetId = href.split('/').pop()
              break
            }
          }

          // Fallback: se não achou link do autor, pega o primeiro link de status
          if (!tweetLink && allLinks.length > 0) {
            // Pega o último link (geralmente é o tweet atual, não o citado)
            const lastLink = allLinks[allLinks.length - 1]
            tweetLink = lastLink.href || ''
            tweetId = tweetLink.split('/').pop()
          }

          // Verifica se é uma resposta (tem "Replying to")
          const replyingTo = article.innerText?.includes('Replying to')

          // Aceita se temos autor, texto e tweetId válido
          if (author && text && tweetId && tweetLink) {
            items.push({
              author,
              text: text.slice(0, 280),
              tweetId,
              tweetUrl: tweetLink,
              isReply: !!replyingTo
            })
          }
        } catch (e) {
          // ignora erros de parsing
        }
      }

      return items.slice(0, 20)
    })

    await page.close()

    // Filtra apenas replies que não são nossos e que não respondemos ainda
    for (const notif of notifications) {
      if (notif.author.toLowerCase() !== CONFIG.myUsername.toLowerCase() &&
          !state.repliedTo.has(notif.tweetId)) {
        replies.push(notif)
      }
    }

    console.log(`Encontrados ${replies.length} replies para responder`)
    return replies

  } catch (e) {
    console.error('Erro ao buscar notificações:', e.message)
    return []
  }
}

/**
 * Busca contexto completo da thread antes de responder
 */
async function fetchThreadContext(browser, tweetUrl) {
  let page
  try {
    page = await browser.newPage()
    await page.setDefaultTimeout(30000)

    console.log('📖 Lendo contexto da thread...')
    await page.goto(tweetUrl, { waitUntil: 'networkidle2' })
    await new Promise(r => setTimeout(r, 2000))

    const context = await page.evaluate(() => {
      const result = {
        originalTweet: '',
        myReply: '',
        threadReplies: []
      }

      const articles = document.querySelectorAll('article[data-testid="tweet"]')

      for (let i = 0; i < articles.length && i < 5; i++) {
        const article = articles[i]
        const textEl = article.querySelector('[data-testid="tweetText"]')
        const text = textEl?.innerText || ''

        // Identifica o autor
        const authorLink = article.querySelector('a[href^="/"][tabindex="-1"]')
        const author = authorLink?.href?.split('/')[3] || ''

        if (i === 0) {
          // Primeiro tweet é o original ou o contexto principal
          result.originalTweet = text.slice(0, 500)
        } else if (author.toLowerCase() === 'gabrielabiramia') {
          result.myReply = text.slice(0, 300)
        } else {
          result.threadReplies.push({
            author: author,
            text: text.slice(0, 200)
          })
        }
      }

      return result
    })

    await page.close()
    return context

  } catch (e) {
    console.log('⚠️ Erro ao buscar contexto:', e.message)
    if (page) await page.close().catch(() => {})
    return null
  }
}

/**
 * Gera resposta gentil e humorística COM CONTEXTO
 */
async function generateFriendlyReply(theirReply, context = null) {
  // Monta contexto detalhado
  let contextStr = ''
  if (context) {
    if (context.originalTweet) {
      contextStr += `TWEET ORIGINAL: "${context.originalTweet}"\n\n`
    }
    if (context.myReply) {
      contextStr += `MEU REPLY ANTERIOR: "${context.myReply}"\n\n`
    }
  }

  const prompt = `Você é Gabriel (@gabrielabiramia), respondendo a alguém em uma conversa no Twitter/X.

${contextStr ? '=== CONTEXTO DA CONVERSA ===\n' + contextStr : ''}
=== REPLY DA PESSOA (para você responder) ===
"${theirReply}"

INSTRUÇÕES:
1. LEIA O CONTEXTO para entender a conversa
2. Responda de forma que faça SENTIDO com o que foi discutido
3. Se for crítica ou correção → reconheça com humildade: "fair point", "you're right", "my bad"
4. Se for pergunta → responda diretamente ao que foi perguntado
5. Se for humor/sarcasmo → responda com humor
6. Se for informação → agradeça de forma genuína

REGRAS:
- MÁXIMO 60 caracteres
- Use 1-2 emojis no final
- Seja casual e humano
- A resposta deve fazer SENTIDO no contexto da conversa
- Se a pessoa estiver certa, admita

EXEMPLOS COM CONTEXTO:
- Contexto: você disse algo controverso, pessoa corrige → "you're right, my bad 🤔"
- Contexto: pessoa pergunta se você leu algo → "not fully tbh, will check 📚"
- Contexto: pessoa concorda → "right?? 🙏"
- Contexto: pessoa discorda educadamente → "fair point actually 👍"

Responda APENAS com o texto do reply (sem aspas, sem explicação):`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 100,
      messages: [{ role: 'user', content: prompt }]
    })

    let reply = response.content[0].text.trim()

    // Remove aspas se houver
    reply = reply.replace(/^["']|["']$/g, '')

    // Garante que não é muito longo
    if (reply.length > 60) {
      reply = reply.slice(0, 57) + '...'
    }

    return reply
  } catch (e) {
    console.error('Erro ao gerar reply:', e.message)
    return null
  }
}

/**
 * Curte e responde um tweet
 */
async function likeAndReply(browser, tweetUrl, replyText) {
  let page
  try {
    page = await browser.newPage()
    await page.setDefaultTimeout(60000)

    console.log(`Navegando para: ${tweetUrl}`)
    await page.goto(tweetUrl, { waitUntil: 'networkidle2' })
    await new Promise(r => setTimeout(r, 2000))

    // Curte o tweet
    console.log('Curtindo...')
    try {
      const likeButton = await page.$('[data-testid="like"]')
      if (likeButton) {
        await likeButton.click()
        await new Promise(r => setTimeout(r, 1000))
        console.log('✅ Curtido!')
      }
    } catch (e) {
      console.log('Like: já curtido ou erro')
    }

    // Clica em reply
    console.log('Abrindo reply...')
    const replyButton = await page.$('[data-testid="reply"]')
    if (replyButton) {
      await replyButton.click()
      await new Promise(r => setTimeout(r, 2000))
    }

    // Encontra o campo de texto
    const textbox = await page.$('[data-testid="tweetTextarea_0"]')
    if (!textbox) {
      throw new Error('Campo de texto não encontrado')
    }

    // Digita o reply
    console.log(`Digitando: "${replyText}"`)
    await textbox.click()
    await new Promise(r => setTimeout(r, 500))

    // Insere texto via DOM
    await page.evaluate((text) => {
      const el = document.querySelector('[data-testid="tweetTextarea_0"]')
      if (el) {
        el.focus()
        document.execCommand('insertText', false, text)
      }
    }, replyText)

    await new Promise(r => setTimeout(r, 1000))

    // Clica em postar
    const postButton = await page.$('[data-testid="tweetButton"]')
    if (postButton) {
      await postButton.click()
      await new Promise(r => setTimeout(r, 3000))
      console.log('✅ Reply postado!')
      return true
    }

    return false

  } catch (e) {
    console.error('Erro ao postar reply:', e.message)
    return false
  } finally {
    if (page) await page.close().catch(() => {})
  }
}

/**
 * Processa um reply
 */
async function processReply(browser, notification, dryRun = false) {
  console.log(`\n--- Processando reply de @${notification.author} ---`)
  console.log(`Texto: "${notification.text.slice(0, 100)}..."`)

  // Verifica limite de 2 replies por PESSOA por thread
  const currentCount = getPersonReplyCount(notification.author, notification.tweetUrl)

  if (!canReplyToPerson(notification.author, notification.tweetUrl)) {
    console.log(`⏸️ Limite atingido: já respondi @${notification.author} ${currentCount}x nessa thread`)
    console.log('   → Você assume essa conversa!')
    state.repliedTo.add(notification.tweetId) // Marca como processado mesmo sem responder
    saveState()
    return false
  }

  console.log(`📊 @${notification.author}: ${currentCount}/${CONFIG.maxRepliesPerThread} replies`)

  // NOVO: Busca contexto completo da thread
  const context = await fetchThreadContext(browser, notification.tweetUrl)
  if (context) {
    if (context.originalTweet) {
      console.log(`📄 Tweet original: "${context.originalTweet.slice(0, 80)}..."`)
    }
    if (context.myReply) {
      console.log(`💬 Meu reply: "${context.myReply.slice(0, 60)}..."`)
    }
  }

  // Gera resposta COM CONTEXTO
  const response = await generateFriendlyReply(notification.text, context)

  if (!response) {
    console.log('❌ Não conseguiu gerar resposta')
    return false
  }

  console.log(`Resposta gerada: "${response}"`)

  if (dryRun) {
    console.log('(dry-run - não postando)')
    return true
  }

  // Posta
  const success = await likeAndReply(browser, notification.tweetUrl, response)

  if (success) {
    state.repliedTo.add(notification.tweetId)
    const newCount = incrementPersonReplyCount(notification.author, notification.tweetUrl)
    saveState()
    console.log(`✅ Sucesso! (reply ${newCount}/${CONFIG.maxRepliesPerThread} para @${notification.author})`)

    if (newCount >= CONFIG.maxRepliesPerThread) {
      console.log(`⚠️ Limite atingido com @${notification.author} - você assume essa conversa!`)
    }
  }

  return success
}

/**
 * Ciclo principal
 */
async function runCycle(dryRun = false) {
  console.log(`\n[${new Date().toLocaleTimeString()}] Iniciando ciclo de reply-to-reply...`)

  const browser = await connectChrome()
  if (!browser) {
    console.error('Chrome não disponível')
    return
  }

  try {
    // Busca replies
    const replies = await findRepliesToOurReplies(browser)

    if (replies.length === 0) {
      console.log('Nenhum reply novo para responder')
      return
    }

    // Processa até o limite
    let processed = 0
    for (const reply of replies.slice(0, CONFIG.maxRepliesPerCycle)) {
      const success = await processReply(browser, reply, dryRun)
      if (success) processed++

      // Delay entre replies
      if (!dryRun) {
        await new Promise(r => setTimeout(r, 5000))
      }
    }

    console.log(`\nCiclo completo: ${processed}/${replies.length} replies processados`)

  } finally {
    // Não desconecta o browser pois é compartilhado
  }
}

/**
 * Main
 */
async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const daemon = args.includes('--daemon')

  console.log('🔄 Reply-to-Reply - Bot X Reply')
  console.log(`Modo: ${dryRun ? 'DRY-RUN' : 'PRODUÇÃO'}`)

  loadState()
  console.log(`Estado carregado: ${state.repliedTo.size} replies já respondidos`)

  if (daemon) {
    console.log(`Rodando em modo daemon (intervalo: ${CONFIG.checkInterval/60000}min)`)

    while (true) {
      await runCycle(dryRun)
      console.log(`\nPróximo ciclo em ${CONFIG.checkInterval/60000} minutos...`)
      await new Promise(r => setTimeout(r, CONFIG.checkInterval))
    }
  } else {
    await runCycle(dryRun)
    process.exit(0) // Força saída quando não é daemon
  }
}

main().catch(e => {
  console.error('Erro fatal:', e)
  process.exit(1)
})
