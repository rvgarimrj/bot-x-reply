import TelegramBot from 'node-telegram-bot-api'
import 'dotenv/config'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const CHAT_ID = process.env.TELEGRAM_CHAT_ID

let bot = null
let chatId = CHAT_ID

/**
 * Inicializa o bot do Telegram
 */
export function initBot(options = {}) {
  if (!BOT_TOKEN) {
    throw new Error('TELEGRAM_BOT_TOKEN não configurado no .env')
  }

  bot = new TelegramBot(BOT_TOKEN, { polling: options.polling !== false })

  console.log('Bot Telegram inicializado')
  return bot
}

/**
 * Define o chat ID para enviar mensagens
 */
export function setChatId(id) {
  chatId = id
}

/**
 * Envia mensagem simples
 */
export async function sendMessage(text, options = {}) {
  if (!bot) initBot({ polling: false })
  if (!chatId) throw new Error('Chat ID não configurado')

  return bot.sendMessage(chatId, text, {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...options
  })
}

/**
 * Envia foto/screenshot
 */
export async function sendPhoto(photoPath, caption = '') {
  if (!bot) initBot({ polling: false })
  if (!chatId) throw new Error('Chat ID não configurado')

  return bot.sendPhoto(chatId, photoPath, { caption, parse_mode: 'HTML' })
}

/**
 * Envia opções de reply para aprovação
 * @param {object} tweet - Dados do tweet
 * @param {string[]} replies - Array de 3 opções de reply
 * @param {object} recommendation - Recomendação de qual é melhor { index, reason, confidence }
 */
export async function sendReplyOptions(tweet, replies, recommendation = null) {
  if (!bot) initBot({ polling: false })
  if (!chatId) throw new Error('Chat ID não configurado')

  const recIndex = recommendation?.index ?? 0

  // Emojis diferentes para destacar o recomendado
  const emojis = ['1️⃣', '2️⃣', '3️⃣']
  const recEmoji = '⭐'

  // Link clicável do tweet
  const tweetLink = tweet.url ? `\n\n🔗 <a href="${tweet.url}">Abrir tweet no X</a>` : ''

  let message = `<b>Tweet de @${tweet.author}:</b>
<i>"${escapeHtml(truncate(tweet.text, 200))}"</i>${tweetLink}

<b>Escolha um reply:</b>
`

  replies.forEach((reply, i) => {
    const isRec = i === recIndex
    const emoji = isRec ? `${recEmoji} ${emojis[i]}` : emojis[i]
    const highlight = isRec ? ' <b>[RECOMENDADO]</b>' : ''
    message += `\n${emoji} ${escapeHtml(reply)}${highlight}\n`
  })

  // Adiciona razão da recomendação
  if (recommendation?.reason) {
    message += `\n💡 <i>${recommendation.reason}</i>`
    if (recommendation.confidence) {
      const conf = { high: '🟢', medium: '🟡', low: '🔴' }
      message += ` ${conf[recommendation.confidence] || ''}`
    }
  }

  // Botões: Copiar (para uso manual) e Postar (automático)
  const copyButtons = replies.map((_, i) => {
    const isRec = i === recIndex
    const text = isRec ? `⭐ 📋${i + 1}` : `📋${i + 1}`
    return { text, callback_data: `copy_${i + 1}` }
  })

  const postButtons = replies.map((_, i) => {
    const isRec = i === recIndex
    const text = isRec ? `⭐ Postar` : `Postar ${i + 1}`
    return { text, callback_data: `reply_${i + 1}` }
  })

  const keyboard = {
    inline_keyboard: [
      copyButtons,
      postButtons,
      [
        { text: '🔄 Regenerar', callback_data: 'regenerate' },
        { text: '❌ Cancelar', callback_data: 'cancel' }
      ]
    ]
  }

  return bot.sendMessage(chatId, message, {
    parse_mode: 'HTML',
    reply_markup: keyboard,
    disable_web_page_preview: true
  })
}

/**
 * Envia lista de tweets encontrados (Modo B)
 */
export async function sendTweetsList(tweets) {
  if (!bot) initBot({ polling: false })
  if (!chatId) throw new Error('Chat ID não configurado')

  if (tweets.length === 0) {
    return sendMessage('🔍 Nenhum tweet interessante encontrado no momento.')
  }

  let message = `<b>🎯 Encontrei ${tweets.length} tweet(s) para engajar:</b>\n\n`

  const buttons = []
  tweets.slice(0, 5).forEach((tweet, i) => {
    const num = i + 1
    const timeAgo = getTimeAgo(tweet.timestamp)
    message += `<b>${num}.</b> @${tweet.author}: "${truncate(tweet.text, 100)}"\n`
    message += `   ⏰ ${timeAgo} | ❤️ ${tweet.likes || 0} | 💬 ${tweet.replies || 0}\n\n`

    buttons.push({ text: `${num}`, callback_data: `select_tweet_${i}` })
  })

  const keyboard = {
    inline_keyboard: [
      buttons,
      [{ text: '🔄 Buscar Novos', callback_data: 'search_new' }, { text: '❌ Fechar', callback_data: 'close' }]
    ]
  }

  return bot.sendMessage(chatId, message, {
    parse_mode: 'HTML',
    reply_markup: keyboard,
    disable_web_page_preview: true
  })
}

/**
 * Notifica que reply foi postado com sucesso
 */
export async function sendSuccessNotification(tweet, reply, screenshotPath = null) {
  const message = `<b>✅ Reply postado com sucesso!</b>

<b>Tweet:</b> @${tweet.author}
<b>Reply:</b> "${escapeHtml(reply)}"

🔗 <a href="${tweet.url}">Ver no X</a>`

  if (screenshotPath) {
    return sendPhoto(screenshotPath, message)
  }
  return sendMessage(message)
}

/**
 * Notifica erro
 */
export async function sendError(error, context = '') {
  const message = `<b>Erro${context ? ` em ${context}` : ''}</b>

${escapeHtml(error.message || error)}`

  return sendMessage(message)
}

/**
 * Envia resumo diario do bot autonomo
 * @param {object} stats - Estatisticas do dia
 */
export async function sendDailySummary(stats) {
  if (!bot) initBot({ polling: false })
  if (!chatId) throw new Error('Chat ID nao configurado')

  const date = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  })

  // Monta lista de top contas
  let topAccountsSection = ''
  if (stats.topAccounts && stats.topAccounts.length > 0) {
    topAccountsSection = stats.topAccounts
      .slice(0, 5)
      .map((a, i) => `   ${i + 1}. @${a.name} (${a.count})`)
      .join('\n')
  } else {
    topAccountsSection = '   Nenhuma conta engajada'
  }

  // Breakdown de idiomas
  const langBreakdown = stats.languageBreakdown || { en: 0, pt: 0, other: 0 }
  const totalLang = langBreakdown.en + langBreakdown.pt + (langBreakdown.other || 0)

  const message = `<b>Resumo Diario - ${date}</b>

<b>Replies:</b> ${stats.repliesPosted || 0}
<b>Erros:</b> ${stats.errors || 0}
<b>Taxa de sucesso:</b> ${stats.successRate || 100}%

<b>Top Contas:</b>
${topAccountsSection}

<b>Idiomas:</b>
   EN: ${langBreakdown.en} | PT: ${langBreakdown.pt}${langBreakdown.other ? ` | Outros: ${langBreakdown.other}` : ''}

<b>Operacao:</b> 8h - 23h59
<i>Bot autonomo - sem intervencao manual</i>`

  return bot.sendMessage(chatId, message, {
    parse_mode: 'HTML',
    disable_web_page_preview: true
  })
}

/**
 * Envia notificacao de reply postado automaticamente
 */
export async function sendAutoReplyNotification(tweet, reply, stats) {
  if (!bot) initBot({ polling: false })
  if (!chatId) throw new Error('Chat ID nao configurado')

  const message = `<b>Auto-reply postado</b>

<b>Tweet:</b> @${tweet.author}
<i>"${escapeHtml(truncate(tweet.text, 100))}"</i>

<b>Reply:</b>
"${escapeHtml(reply)}"

Replies hoje: ${stats.repliesPosted}/${stats.dailyTarget || 70}
<a href="${tweet.url}">Ver tweet</a>`

  return bot.sendMessage(chatId, message, {
    parse_mode: 'HTML',
    disable_web_page_preview: true
  })
}

/**
 * Configura handlers para callbacks
 */
export function onCallback(callback) {
  if (!bot) initBot()
  bot.on('callback_query', callback)
}

/**
 * Configura handler para mensagens de texto
 */
export function onMessage(callback) {
  if (!bot) initBot()
  bot.on('message', callback)
}

/**
 * Responde a um callback query
 */
export async function answerCallback(callbackQueryId, text = '') {
  return bot.answerCallbackQuery(callbackQueryId, { text })
}

/**
 * Edita mensagem existente
 */
export async function editMessage(messageId, newText, keyboard = null) {
  const options = {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  }
  if (keyboard) {
    options.reply_markup = keyboard
  }
  return bot.editMessageText(newText, options)
}

// Helpers
function escapeHtml(text) {
  if (!text) return ''
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function truncate(text, maxLength) {
  if (!text) return ''
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - 3) + '...'
}

function getTimeAgo(timestamp) {
  if (!timestamp) return 'agora'
  const now = Date.now()
  const diff = now - new Date(timestamp).getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)

  if (minutes < 1) return 'agora'
  if (minutes < 60) return `${minutes}min`
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

export default {
  initBot,
  setChatId,
  sendMessage,
  sendPhoto,
  sendReplyOptions,
  sendTweetsList,
  sendSuccessNotification,
  sendError,
  sendDailySummary,
  sendAutoReplyNotification,
  onCallback,
  onMessage,
  answerCallback,
  editMessage
}
