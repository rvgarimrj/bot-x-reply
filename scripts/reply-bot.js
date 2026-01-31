#!/usr/bin/env node

/**
 * Bot-X-Reply - Bot de engajamento no X
 *
 * Fluxo automático:
 * 1. Usuário envia URL de tweet
 * 2. Bot extrai tweet via API do X
 * 3. Claude gera 3 opções de reply
 * 4. Usuário escolhe um
 * 5. Bot posta via API do X
 */

import 'dotenv/config'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import telegram from '../src/telegram.js'
import { generateReplies } from '../src/claude.js'
import { getTweet, extractTweetId } from '../src/twitter.js' // API para LER (quota alta)
import { extractTweet as extractTweetPuppeteer } from '../src/puppeteer.js' // Fallback via browser
import { postReply as postReplyBrowser } from '../src/puppeteer.js' // Puppeteer para POSTAR (zero API)
import { findBestTweets, formatTweetCard } from '../src/tweet-finder.js' // Busca proativa
import { canPostMore, recordReply, getDailyStats } from '../src/finder.js'
import {
  recommendBestReply,
  recordPostedReply,
  getKnowledgeSummary,
  getKnowledgeContext
} from '../src/knowledge.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Arquivos compartilhados com o daemon de busca
const SHARED_SUGGESTIONS_FILE = join(__dirname, '../.suggestions.json')
const INTERACTION_FILE = join(__dirname, '../.user-interaction.json')

// Estado do bot
const state = {
  currentTweet: null,
  currentReplies: [],
  currentRecommendation: null,
  awaitingEdit: false,
  foundTweets: [] // Tweets encontrados pelo /buscar
}

/**
 * Sinaliza que o usuário interagiu (para cancelar auto-reply)
 */
function signalUserInteraction() {
  try {
    writeFileSync(INTERACTION_FILE, JSON.stringify({
      timestamp: Date.now(),
      action: 'user_clicked'
    }))
    console.log('📝 Interação do usuário registrada (auto-reply cancelado)')
  } catch (e) {
    // Ignora erros
  }
}

/**
 * Carrega sugestões do arquivo compartilhado (do daemon)
 */
function loadSharedSuggestions() {
  try {
    if (existsSync(SHARED_SUGGESTIONS_FILE)) {
      const data = JSON.parse(readFileSync(SHARED_SUGGESTIONS_FILE, 'utf-8'))
      // Só usa se for recente (menos de 1 hora)
      if (Date.now() - data.timestamp < 3600000) {
        return data.tweets || []
      }
    }
  } catch (e) {
    console.error('Erro ao carregar sugestões:', e.message)
  }
  return []
}

/**
 * Extrai URL de tweet de uma mensagem
 */
function extractTweetUrl(text) {
  const match = text.match(/https?:\/\/(www\.)?(twitter\.com|x\.com)\/\w+\/status\/\d+/i)
  if (match) {
    return match[0].replace('twitter.com', 'x.com')
  }
  return null
}

/**
 * Processa URL de tweet
 * - LER via API do X (quota alta, funciona bem)
 * - POSTAR via Puppeteer (zero consumo de API)
 */
async function processTweetUrl(url) {
  try {
    // Verifica limite diário
    if (!canPostMore()) {
      const stats = getDailyStats()
      await telegram.sendMessage(
        `⚠️ Limite diário atingido (${stats.repliesPosted}/10 replies).\nTente novamente amanhã.`
      )
      return
    }

    // Mensagem de loading
    await telegram.sendMessage('🔍 Extraindo tweet...')

    // Extrai ID e busca tweet via API (READ - quota alta)
    const tweetId = extractTweetId(url)
    if (!tweetId) {
      await telegram.sendMessage('❌ URL inválida. Envie uma URL de tweet do X.')
      return
    }

    // Tenta API do X primeiro
    let tweet = await getTweet(tweetId)

    // Se API falhar, tenta Puppeteer como fallback
    if (!tweet) {
      console.log('API falhou, tentando Puppeteer...')
      try {
        const puppeteerResult = await extractTweetPuppeteer(url)
        if (puppeteerResult.success && puppeteerResult.text) {
          tweet = {
            id: tweetId,
            text: puppeteerResult.text,
            author: puppeteerResult.author || 'unknown',
            likes: puppeteerResult.likes || 0,
            replies: puppeteerResult.replies || 0,
            retweets: puppeteerResult.retweets || 0
          }
          console.log('✅ Tweet extraído via Puppeteer')
        }
      } catch (e) {
        console.error('Puppeteer fallback falhou:', e.message)
      }
    }

    if (!tweet || !tweet.text) {
      await telegram.sendMessage(
        '❌ Não consegui acessar o tweet.\n\n' +
        'Cole o texto do tweet aqui que eu gero os replies:'
      )
      state.awaitingEdit = 'manual_text'
      state.currentTweet = { url, id: tweetId, author: 'unknown' }
      return
    }

    // Tweet encontrado!
    state.currentTweet = { ...tweet, url }

    await telegram.sendMessage(
      `📝 <b>Tweet de @${tweet.author}:</b>\n` +
      `<i>"${truncate(tweet.text, 200)}"</i>\n\n` +
      `❤️ ${tweet.likes} | 💬 ${tweet.replies} | 🔄 ${tweet.retweets}\n\n` +
      `🤖 Gerando replies...`
    )

    // Gera replies (com contexto de conhecimento se disponível)
    const knowledgeCtx = getKnowledgeContext()
    const result = await generateReplies(tweet.text, tweet.author, {
      additionalContext: knowledgeCtx
    })

    if (!result.success || result.replies.length === 0) {
      await telegram.sendMessage('❌ Erro ao gerar replies. Tente novamente.')
      return
    }

    state.currentReplies = result.replies

    // Analisa qual é o melhor reply baseado no conhecimento
    const recommendation = recommendBestReply(result.replies, { tweet })
    state.currentRecommendation = recommendation

    // Mostra opções com destaque no recomendado
    await telegram.sendReplyOptions(state.currentTweet, result.replies, recommendation)

  } catch (error) {
    console.error('Erro:', error)
    await telegram.sendError(error, 'processTweetUrl')
  }
}

/**
 * Posta o reply selecionado via Puppeteer
 */
async function handlePostReply(index) {
  const tweet = state.currentTweet
  const reply = state.currentReplies[index]

  if (!tweet || !reply) {
    await telegram.sendMessage('❌ Erro: tweet ou reply não encontrado')
    return
  }

  try {
    await telegram.sendMessage(
      `📤 <b>Abrindo Chrome e postando reply...</b>\n\n` +
      `"${reply}"\n\n` +
      `⏳ Digitando com velocidade humana...`
    )

    // Posta via Puppeteer (abre Chrome, digita devagar, posta)
    const result = await postReplyBrowser(tweet.url, reply)

    if (result.success) {
      recordReply(tweet.url)

      // Registra no knowledge base para aprendizado
      const wasRecommended = state.currentRecommendation?.index === index
      recordPostedReply({
        tweetUrl: tweet.url,
        tweetAuthor: tweet.author,
        tweetText: tweet.text,
        replyText: reply,
        replyIndex: index + 1,
        wasRecommended
      })

      const stats = getDailyStats()
      const knowledge = getKnowledgeSummary()

      // Envia screenshot de confirmação se disponível
      if (result.screenshot) {
        await telegram.sendPhoto(result.screenshot,
          `✅ <b>Reply postado com sucesso!</b>\n\n` +
          `📊 Replies hoje: ${stats.repliesPosted}/10\n` +
          `🧠 Conhecimento: ${knowledge.totalReplies} replies\n` +
          `🔗 <a href="${tweet.url}">Ver tweet</a>`
        )
      } else {
        await telegram.sendMessage(
          `✅ <b>Reply postado com sucesso!</b>\n\n` +
          `📊 Replies hoje: ${stats.repliesPosted}/10\n` +
          `🧠 Conhecimento: ${knowledge.totalReplies} replies\n\n` +
          `🔗 <a href="${tweet.url}">Ver tweet</a>`
        )
      }
    } else {
      await telegram.sendMessage(
        `❌ Erro ao postar via Chrome:\n${result.error}\n\n` +
        `Você pode copiar e postar manualmente:\n\n"${reply}"`
      )
    }

    // Limpa estado
    state.currentTweet = null
    state.currentReplies = []
    state.awaitingEdit = false

  } catch (error) {
    console.error('Erro ao postar:', error)
    await telegram.sendError(error, 'postReply')
  }
}

/**
 * Handler para callbacks dos botões
 */
async function handleCallback(query) {
  const chatId = query.message.chat.id
  const data = query.data
  const messageId = query.message.message_id

  telegram.setChatId(chatId)
  telegram.answerCallback(query.id)

  if (data.startsWith('copy_')) {
    // Envia reply em mensagem separada para fácil cópia no celular
    const index = parseInt(data.split('_')[1]) - 1
    console.log('Copy clicked, index:', index, 'replies:', state.currentReplies?.length)
    const reply = state.currentReplies[index]
    if (reply) {
      // Envia só o texto, fácil de copiar no celular
      await telegram.sendMessage(`📋 <b>Reply ${index + 1}:</b>\n\n<code>${reply}</code>\n\n👆 Toque no texto acima para copiar`)
    } else {
      await telegram.sendMessage('❌ Reply não encontrado. Tente gerar novamente.')
    }
  }
  else if (data.startsWith('reply_')) {
    const index = parseInt(data.split('_')[1]) - 1
    handlePostReply(index)
  }
  else if (data.startsWith('select_found_')) {
    // Sinaliza interação do usuário (cancela auto-reply)
    signalUserInteraction()

    // Selecionou um tweet da busca - usa dados que já temos
    const index = parseInt(data.split('_')[2])

    // Tenta do estado local primeiro, senão carrega do arquivo compartilhado (daemon)
    let tweet = state.foundTweets[index]
    if (!tweet) {
      console.log('Tweet não encontrado no estado local, buscando do arquivo compartilhado...')
      const sharedTweets = loadSharedSuggestions()
      tweet = sharedTweets[index]
    }

    if (tweet) {
      await telegram.sendMessage(`✅ Selecionado tweet de @${tweet.author}`)
      // Usa o tweet direto, sem precisar buscar de novo
      processFoundTweet(tweet)
    } else {
      await telegram.sendMessage('❌ Tweet não encontrado. A sugestão pode ter expirado.\n\nUse /buscar para buscar novos tweets.')
    }
  }
  else if (data === 'search_again') {
    signalUserInteraction()
    handleSearchTweets()
  }
  else if (data === 'edit') {
    state.awaitingEdit = 'custom_reply'
    telegram.sendMessage('✏️ Digite seu reply personalizado:')
  }
  else if (data === 'regenerate') {
    if (state.currentTweet) {
      telegram.sendMessage('🔄 Regenerando...')
      generateAndSendReplies()
    }
  }
  else if (data === 'cancel') {
    signalUserInteraction()
    state.currentTweet = null
    state.currentReplies = []
    state.awaitingEdit = false
    telegram.editMessage(messageId, '❌ Cancelado')
  }
}

/**
 * Gera e envia replies
 */
async function generateAndSendReplies() {
  const tweet = state.currentTweet
  if (!tweet) return

  const knowledgeCtx = getKnowledgeContext()
  const result = await generateReplies(tweet.text, tweet.author, {
    additionalContext: knowledgeCtx
  })

  if (result.success && result.replies.length > 0) {
    state.currentReplies = result.replies
    const recommendation = recommendBestReply(result.replies, { tweet })
    state.currentRecommendation = recommendation
    await telegram.sendReplyOptions(tweet, result.replies, recommendation)
  } else {
    await telegram.sendMessage('❌ Erro ao gerar replies.')
  }
}

/**
 * Handler para mensagens de texto
 */
function handleMessage(msg) {
  const chatId = msg.chat.id
  const text = msg.text?.trim()

  if (!text) return

  telegram.setChatId(chatId)

  // Comandos
  if (text === '/start' || text === '/help') {
    telegram.sendMessage(
      `👋 <b>Bot-X-Reply</b>\n\n` +
      `<b>Modo A:</b> Cole uma URL de tweet\n` +
      `<b>Modo B:</b> Use /buscar para encontrar tweets\n\n` +
      `<b>Comandos:</b>\n` +
      `/buscar - 🔍 Buscar tweets para engajar\n` +
      `/status - 📊 Estatísticas do dia\n` +
      `/knowledge - 🧠 Base de conhecimento\n` +
      `/help - ❓ Esta mensagem\n\n` +
      `⭐ = reply recomendado\n` +
      `🧠 O bot aprende com cada reply!`
    )
    return
  }

  if (text === '/status') {
    const stats = getDailyStats()
    const remaining = 10 - stats.repliesPosted
    const knowledge = getKnowledgeSummary()

    telegram.sendMessage(
      `📊 <b>Estatísticas de hoje:</b>\n\n` +
      `✅ Replies postados: ${stats.repliesPosted}/10\n` +
      `📝 Tweets analisados: ${stats.tweetsAnalyzed}\n` +
      `🎯 Replies restantes: ${remaining}\n\n` +
      `🧠 <b>Base de Conhecimento:</b>\n` +
      `📚 Total aprendido: ${knowledge.totalReplies} replies\n` +
      `⭐ Padrões detectados: ${knowledge.patternsLearned}\n` +
      `💡 Insights: ${knowledge.insightsCount}`
    )
    return
  }

  if (text === '/knowledge') {
    const knowledge = getKnowledgeSummary()

    let msg = `🧠 <b>Base de Conhecimento</b>\n\n`
    msg += `📚 Total de replies: ${knowledge.totalReplies}\n`
    msg += `❤️ Média de likes: ${knowledge.avgLikes}\n`
    msg += `💬 Média de replies: ${knowledge.avgReplies}\n`
    msg += `⭐ Padrões aprendidos: ${knowledge.patternsLearned}\n`

    if (knowledge.bestReply) {
      msg += `\n🏆 <b>Melhor reply:</b>\n`
      msg += `"${knowledge.bestReply.text}"\n`
      msg += `(${knowledge.bestReply.likes} likes, ${knowledge.bestReply.replies} replies)`
    }

    if (knowledge.lastUpdated) {
      msg += `\n\n🕐 Última atualização: ${new Date(knowledge.lastUpdated).toLocaleString('pt-BR')}`
    }

    telegram.sendMessage(msg)
    return
  }

  if (text === '/buscar') {
    handleSearchTweets()
    return
  }

  // Aguardando texto manual do tweet
  if (state.awaitingEdit === 'manual_text' && state.currentTweet) {
    state.currentTweet.text = text
    state.awaitingEdit = false
    telegram.sendMessage('🤖 Gerando replies...')
    generateAndSendReplies()
    return
  }

  // Aguardando reply customizado
  if (state.awaitingEdit === 'custom_reply' && state.currentTweet) {
    state.currentReplies = [text]
    state.awaitingEdit = false
    handlePostReply(0)
    return
  }

  // Verifica se é URL de tweet
  const tweetUrl = extractTweetUrl(text)
  if (tweetUrl) {
    processTweetUrl(tweetUrl)
    return
  }

  // Mensagem não reconhecida
  telegram.sendMessage('❓ Envie uma URL de tweet ou use /help')
}

function truncate(text, max) {
  return text.length > max ? text.slice(0, max) + '...' : text
}

/**
 * Processa tweet que já veio da busca (sem precisar chamar API)
 */
async function processFoundTweet(tweet) {
  try {
    if (!canPostMore()) {
      const stats = getDailyStats()
      await telegram.sendMessage(`⚠️ Limite diário atingido (${stats.repliesPosted}/10).`)
      return
    }

    state.currentTweet = tweet

    await telegram.sendMessage(
      `📝 <b>Tweet de @${tweet.author}:</b>\n` +
      `<i>"${truncate(tweet.text, 200)}"</i>\n\n` +
      `❤️ ${tweet.likes || 0} | 💬 ${tweet.replies || 0} | 🔄 ${tweet.retweets || 0}\n\n` +
      `🤖 Gerando replies...`
    )

    // Gera replies
    const knowledgeCtx = getKnowledgeContext()
    const result = await generateReplies(tweet.text, tweet.author, {
      additionalContext: knowledgeCtx
    })

    if (!result.success || result.replies.length === 0) {
      await telegram.sendMessage('❌ Erro ao gerar replies. Tente novamente.')
      return
    }

    state.currentReplies = result.replies
    const recommendation = recommendBestReply(result.replies, { tweet })
    state.currentRecommendation = recommendation

    await telegram.sendReplyOptions(state.currentTweet, result.replies, recommendation)

  } catch (error) {
    console.error('Erro:', error)
    await telegram.sendError(error, 'processFoundTweet')
  }
}

/**
 * Busca tweets para engajar (Modo B)
 */
async function handleSearchTweets() {
  try {
    await telegram.sendMessage('🔍 <b>Buscando tweets para engajar...</b>\n\nIsso pode levar alguns segundos...')

    const tweets = await findBestTweets(5)

    if (!tweets || tweets.length === 0) {
      await telegram.sendMessage('😕 Não encontrei tweets relevantes no momento.\n\nTente novamente mais tarde ou envie uma URL diretamente.')
      return
    }

    state.foundTweets = tweets

    // Encontra o melhor tweet (maior score)
    const bestIndex = tweets.reduce((best, t, i) =>
      t.score > tweets[best].score ? i : best, 0)

    let msg = `🎯 <b>Encontrei ${tweets.length} tweets para engajar:</b>\n`

    tweets.forEach((tweet, i) => {
      const isBest = i === bestIndex
      msg += `\n${formatTweetCard(tweet, i + 1, isBest)}\n`
    })

    msg += `\n━━━━━━━━━━━━━━━━━━━━\n`
    msg += `💡 <i>⭐ = melhor oportunidade</i>`

    // Cria botões para cada tweet (destaca o melhor)
    const buttons = tweets.map((_, i) => ({
      text: i === bestIndex ? `⭐ ${i + 1}` : `${i + 1}`,
      callback_data: `select_found_${i}`
    }))

    const keyboard = {
      inline_keyboard: [
        buttons,
        [
          { text: '🔄 Buscar Novos', callback_data: 'search_again' },
          { text: '❌ Fechar', callback_data: 'cancel' }
        ]
      ]
    }

    await telegram.sendMessage(msg, { reply_markup: keyboard })

  } catch (error) {
    console.error('Erro na busca:', error)
    await telegram.sendMessage(
      `❌ Erro ao buscar tweets:\n${error.message}\n\n` +
      `Verifique se o Chrome está rodando na porta 9222.`
    )
  }
}

/**
 * Inicializa o bot
 */
async function main() {
  console.log('🤖 Bot-X-Reply iniciando...')

  try {
    telegram.initBot({ polling: true })
    telegram.onCallback(handleCallback)
    telegram.onMessage(handleMessage)

    console.log('✅ Bot conectado')
    console.log('📱 Aguardando mensagens no Telegram...')

  } catch (error) {
    console.error('❌ Erro:', error)
    process.exit(1)
  }
}

main()
