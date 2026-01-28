/**
 * Browser automation wrapper para Playwright MCP
 *
 * Este módulo NÃO executa Playwright diretamente.
 * Ele gera comandos/instruções para serem executados via Claude Code + Playwright MCP.
 *
 * O fluxo real é:
 * 1. Bot recebe URL do tweet
 * 2. Bot chama Claude Code (via subprocesso ou API)
 * 3. Claude Code executa comandos Playwright MCP
 * 4. Resultados retornam ao bot
 */

/**
 * Configurações de comportamento humano
 */
export const HUMAN_BEHAVIOR = {
  // Delays em milissegundos
  delays: {
    pageLoad: { min: 2000, max: 4000 },
    beforeClick: { min: 500, max: 1500 },
    beforeType: { min: 300, max: 800 },
    betweenChars: { min: 30, max: 80 },
    afterAction: { min: 1000, max: 3000 },
    readTweet: { min: 3000, max: 6000 }
  },
  // Simulação de scroll
  scroll: {
    enabled: true,
    smallScroll: { min: 100, max: 300 },
    beforeInteract: true
  }
}

/**
 * Gera delay aleatório dentro do range
 */
export function randomDelay(range) {
  return Math.floor(Math.random() * (range.max - range.min + 1)) + range.min
}

/**
 * Gera instruções para extrair dados de um tweet
 */
export function getExtractTweetInstructions(tweetUrl) {
  return {
    action: 'extract_tweet',
    url: tweetUrl,
    steps: [
      { action: 'navigate', url: tweetUrl },
      { action: 'wait', timeout: randomDelay(HUMAN_BEHAVIOR.delays.pageLoad) },
      { action: 'snapshot', description: 'Captura estado da página' },
      {
        action: 'extract',
        selectors: {
          text: '[data-testid="tweetText"]',
          author: '[data-testid="User-Name"] a',
          likes: '[data-testid="like"] span',
          replies: '[data-testid="reply"] span',
          retweets: '[data-testid="retweet"] span',
          time: 'time'
        }
      }
    ]
  }
}

/**
 * Gera instruções para postar um reply
 */
export function getPostReplyInstructions(tweetUrl, replyText) {
  return {
    action: 'post_reply',
    url: tweetUrl,
    replyText,
    steps: [
      // 1. Navegar até o tweet
      { action: 'navigate', url: tweetUrl },
      { action: 'wait', timeout: randomDelay(HUMAN_BEHAVIOR.delays.pageLoad) },

      // 2. Scroll suave para ver o tweet
      { action: 'scroll', amount: randomDelay(HUMAN_BEHAVIOR.scroll.smallScroll) },
      { action: 'wait', timeout: randomDelay(HUMAN_BEHAVIOR.delays.readTweet) },

      // 3. Dar like (se ainda não tiver)
      { action: 'like_if_not_liked', selector: '[data-testid="like"]' },
      { action: 'wait', timeout: randomDelay(HUMAN_BEHAVIOR.delays.afterAction) },

      // 4. Clicar no campo de reply
      { action: 'click', selector: '[data-testid="reply"]' },
      { action: 'wait', timeout: randomDelay(HUMAN_BEHAVIOR.delays.beforeType) },

      // 5. Digitar reply com velocidade humana
      {
        action: 'type_human',
        text: replyText,
        charDelay: HUMAN_BEHAVIOR.delays.betweenChars
      },
      { action: 'wait', timeout: randomDelay(HUMAN_BEHAVIOR.delays.beforeClick) },

      // 6. Clicar em "Reply" para postar
      { action: 'click', selector: '[data-testid="tweetButtonInline"]' },
      { action: 'wait', timeout: randomDelay(HUMAN_BEHAVIOR.delays.afterAction) },

      // 7. Screenshot de confirmação
      { action: 'screenshot', filename: 'reply_confirmation.png' }
    ]
  }
}

/**
 * Gera instruções para buscar tweets de uma conta
 */
export function getSearchTweetsInstructions(username, options = {}) {
  const maxTweets = options.maxTweets || 10

  return {
    action: 'search_tweets',
    username,
    maxTweets,
    steps: [
      { action: 'navigate', url: `https://x.com/${username}` },
      { action: 'wait', timeout: randomDelay(HUMAN_BEHAVIOR.delays.pageLoad) },
      { action: 'snapshot', description: 'Perfil carregado' },

      // Scroll para carregar mais tweets
      { action: 'scroll', amount: 500 },
      { action: 'wait', timeout: 1500 },
      { action: 'scroll', amount: 500 },
      { action: 'wait', timeout: 1500 },

      // Extrair tweets
      {
        action: 'extract_multiple',
        selector: '[data-testid="tweet"]',
        maxItems: maxTweets,
        fields: {
          text: '[data-testid="tweetText"]',
          author: username,
          likes: '[data-testid="like"] span',
          replies: '[data-testid="reply"] span',
          time: 'time',
          url: 'a[href*="/status/"]'
        }
      }
    ]
  }
}

/**
 * Gera instruções para buscar na timeline
 */
export function getSearchTimelineInstructions(options = {}) {
  return {
    action: 'search_timeline',
    steps: [
      { action: 'navigate', url: 'https://x.com/home' },
      { action: 'wait', timeout: randomDelay(HUMAN_BEHAVIOR.delays.pageLoad) },

      // Scroll para carregar tweets
      { action: 'scroll', amount: 800 },
      { action: 'wait', timeout: 2000 },

      // Extrair tweets da timeline
      {
        action: 'extract_multiple',
        selector: '[data-testid="tweet"]',
        maxItems: options.maxTweets || 20,
        fields: {
          text: '[data-testid="tweetText"]',
          author: '[data-testid="User-Name"]',
          likes: '[data-testid="like"] span',
          replies: '[data-testid="reply"] span',
          time: 'time',
          url: 'a[href*="/status/"]'
        }
      }
    ]
  }
}

/**
 * Formata instruções como prompt para Claude Code
 */
export function formatAsClaudePrompt(instructions) {
  const { action, steps } = instructions

  let prompt = `Execute a seguinte automação no X usando Playwright MCP:\n\n`
  prompt += `AÇÃO: ${action}\n\n`
  prompt += `PASSOS:\n`

  steps.forEach((step, i) => {
    prompt += `${i + 1}. ${formatStep(step)}\n`
  })

  prompt += `\nIMPORTANTE:\n`
  prompt += `- Use mcp__playwright__browser_navigate para navegar\n`
  prompt += `- Use mcp__playwright__browser_snapshot para capturar estado\n`
  prompt += `- Use mcp__playwright__browser_click para clicar\n`
  prompt += `- Use mcp__playwright__browser_type para digitar\n`
  prompt += `- Use mcp__playwright__browser_wait_for para aguardar\n`
  prompt += `- Use mcp__playwright__browser_take_screenshot para screenshot\n`
  prompt += `- Retorne os dados extraídos em formato JSON\n`

  return prompt
}

function formatStep(step) {
  switch (step.action) {
    case 'navigate':
      return `Navegue para: ${step.url}`
    case 'wait':
      return `Aguarde ${step.timeout}ms`
    case 'scroll':
      return `Scroll de ${step.amount}px`
    case 'click':
      return `Clique em: ${step.selector}`
    case 'type_human':
      return `Digite com velocidade humana: "${step.text}"`
    case 'snapshot':
      return `Capture snapshot: ${step.description || ''}`
    case 'screenshot':
      return `Tire screenshot: ${step.filename}`
    case 'extract':
      return `Extraia dados dos seletores: ${JSON.stringify(step.selectors)}`
    case 'extract_multiple':
      return `Extraia múltiplos items de: ${step.selector}`
    case 'like_if_not_liked':
      return `Dê like se ainda não tiver (${step.selector})`
    default:
      return `${step.action}: ${JSON.stringify(step)}`
  }
}

export default {
  HUMAN_BEHAVIOR,
  randomDelay,
  getExtractTweetInstructions,
  getPostReplyInstructions,
  getSearchTweetsInstructions,
  getSearchTimelineInstructions,
  formatAsClaudePrompt
}
