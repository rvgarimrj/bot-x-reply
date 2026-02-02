import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { researchTweet } from './research.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const anthropic = new Anthropic()

// Carrega perfil do usuário
const profilePath = join(__dirname, '../config/profile.json')
let profile = {}
try {
  profile = JSON.parse(readFileSync(profilePath, 'utf-8'))
} catch (e) {
  console.warn('Perfil não encontrado, usando padrões')
}

/**
 * ESTILOS ROTATIVOS (anti-detecção de IA)
 * IMPORTANTE: Variar muito! Nunca repetir padrões como "ngl", "tbh" em sequência
 * IMPORTANTE: Nem sempre concordar! Dar opinião própria, discordar às vezes
 * Cada estilo tem um nome, exemplo e dica para o prompt
 */
const STYLE_ROTATION = {
  en: [
    { name: 'direct', hint: 'super short reaction, 3-6 words only', example: 'this is wild' },
    { name: 'memory', hint: 'personal memory, start with "i remember" or past tense', example: 'used to see this pattern back in 2021' },
    { name: 'observation', hint: 'point out something specific you noticed', example: 'that 70k zone looking dangerous' },
    { name: 'question', hint: 'genuine curious question', example: 'when did this start happening?' },
    { name: 'disagree', hint: 'politely disagree or offer counter view', example: 'idk i think the opposite might happen' },
    { name: 'contrarian', hint: 'take opposite stance with reason', example: 'everyone saying this but last time it dumped' },
    { name: 'skeptic', hint: 'express doubt about the premise', example: 'feels like a trap setup' },
    { name: 'add_context', hint: 'add missing info they didnt mention', example: 'worth noting funding rates are still negative' },
    { name: 'personal_take', hint: 'your own opinion/prediction', example: 'my bet is we sweep lows first' },
    { name: 'experience', hint: 'share what happened to you', example: 'got rekt last time i faded this signal' },
  ],
  pt: [
    { name: 'direto', hint: 'reação curta, 3-6 palavras', example: 'isso ta tenso' },
    { name: 'memória', hint: 'memória pessoal, passado', example: 'vi isso acontecer em 2021' },
    { name: 'observação', hint: 'aponta algo específico', example: 'essa zona de 70k preocupa' },
    { name: 'pergunta', hint: 'pergunta genuína curiosa', example: 'desde quando ta assim?' },
    { name: 'discordo', hint: 'discorda educadamente', example: 'sei la acho q vai ser o contrario' },
    { name: 'contrario', hint: 'visão oposta com razão', example: 'todo mundo falando isso mas ultima vez despencou' },
    { name: 'cetico', hint: 'duvida da premissa', example: 'parece armadilha isso ai' },
    { name: 'contexto', hint: 'adiciona info que faltou', example: 'funding ainda ta negativo ne' },
    { name: 'opiniao', hint: 'sua previsão/opinião própria', example: 'aposto q vai buscar fundo antes' },
    { name: 'experiencia', hint: 'compartilha o que aconteceu contigo', example: 'tomei no ** da ultima vez q ignorei isso' },
  ]
}

/**
 * Palavras/frases PROIBIDAS de começar reply (muito detectável como IA)
 */
const BANNED_STARTERS = {
  en: ['ngl', 'tbh', 'honestly', 'actually', 'interestingly', 'fun fact'],
  pt: ['na verdade', 'sinceramente', 'honestamente', 'curiosamente', 'basicamente']
}

/**
 * Escolhe um estilo que não foi usado recentemente
 */
export function getStyleHint(language, lastStyles = []) {
  const styles = STYLE_ROTATION[language] || STYLE_ROTATION.en
  // Evita repetir os últimos 5 estilos usados (mais restritivo)
  const available = styles.filter(s => !lastStyles.slice(-5).includes(s.name))
  // Se todos foram usados recentemente, usa qualquer um exceto o último
  const pool = available.length > 0 ? available : styles.filter(s => s.name !== lastStyles[lastStyles.length - 1])
  const chosen = pool[Math.floor(Math.random() * pool.length)] || styles[0]
  return chosen
}

/**
 * Retorna lista de palavras proibidas por idioma
 */
export function getBannedStarters(language) {
  return BANNED_STARTERS[language] || BANNED_STARTERS.en
}

/**
 * Lista de estilos disponíveis por idioma
 */
export function getAvailableStyles(language) {
  return (STYLE_ROTATION[language] || STYLE_ROTATION.en).map(s => s.name)
}

/**
 * Prompt do sistema - replies HUMANOS (anti-detecção de IA)
 */
const REPLY_SYSTEM_PROMPT = `Você gera replies para Twitter que parecem 100% HUMANOS.

PERFIL: @${profile.x_username || 'user'} - ${(profile.expertise || []).join(', ')}

REGRA #1: PARECER HUMANO (anti-detecção de IA)

PROIBIDO (detectável como IA):

Em inglês:
- "Fun fact:", "Interestingly,", "It's worth noting", "Actually,"
- "masterpiece", "revolutionary", "game-changer", "countless", "incredible"
- "This is amazing!", "Great point!", "Absolutely!"

Em português:
- "Curiosidade:", "Vale ressaltar:", "É interessante notar"
- "obra-prima", "revolucionário", "incrível", "impressionante"
- "Muito bom!", "Excelente!", "Perfeito!", "Concordo plenamente!"
- "Na verdade,", "De fato,"

Ambos idiomas:
- Estrutura perfeita com múltiplos pontos organizados
- Gramática 100% perfeita sem informalidades
- Empacotar muitos dados/fatos em um reply
- Travessões separando múltiplas informações

COMO HUMANOS ESCREVEM:

Em inglês:
- "yo", "lol", "lowkey", "fr", "damn", "wait"
- "this is wild", "no way", "makes sense"
- NUNCA comece com: "ngl", "tbh", "honestly", "actually" (muito IA)

Em português:
- "cara", "mano", "véi", "sério?", "nossa", "pô", "caramba"
- "vc", "tb", "pq", "q", "mt", "mto"
- "slc", "mlk", "mds", "kkkk"

Ambos: opinião direta, uma ideia só, informal, memória pessoal

EXEMPLOS HUMANOS:

Português:
- "jogava isso direto quando criança, as animações de morte eram brutais"
- "esse jogo é mt bom, joguei demais"
- "cara lembro disso, era insano"
- "saudades dessa época"

English:
- "played this so much as a kid"
- "this game was ahead of its time tbh"
- "the intro still hits different"
- "classic, flashback was great too"

REGRAS:
1. IDIOMA: mesmo do tweet original
2. TAMANHO: 50-150 chars (curto e direto)
3. TOM: casual, como se fosse seu amigo respondendo
4. CONTEÚDO: uma observação, opinião ou experiência - NÃO uma aula
5. NEM SEMPRE CONCORDE! Às vezes:
   - Discorde educadamente
   - Questione a premissa
   - Traga outro ângulo que ele não pensou
   - Adicione contexto que falta
   - Dê sua própria previsão/opinião
6. NUNCA comece com: ngl, tbh, honestly, actually, na verdade, sinceramente

FORMATO: 3 opções numeradas, cada uma com estilo diferente:
1. [reação/opinião pessoal curta]
2. [experiência ou memória relacionada]
3. [observação casual com conhecimento sutil]`

/**
 * Detecta o idioma do texto
 */
export function detectLanguage(text) {
  const lowerText = text.toLowerCase()

  // Caracteres e padrões exclusivos de cada idioma
  const ptIndicators = [
    /[ãõç]/g,
    /\b(você|vocês|não|então|também|já|até|depois|porque|porquê|está|estão|são|foi|foram|muito|pouco|aqui|ali|agora|ainda|sempre|nunca|nada|tudo|isso|este|esta|esse|essa|esses|essas|dele|dela|nosso|nossa|seu|sua|meu|minha|fazer|faz|feito|ter|tem|tinha|tenho|ser|sou|era|foi|ir|vai|vamos|vou|ver|vejo|dar|dá|dou|ficar|fica|ficou|querer|quer|quero|poder|pode|posso|dever|deve|devo|precisar|preciso|saber|sei|sabia|achar|acho|achei|pensar|penso|pensei|olhar|olha|olho|falar|falo|falou|dizer|diz|disse|entender|entendo|entendi)\b/gi
  ]

  const esIndicators = [
    /[ñ¿¡]/g,
    /\b(usted|ustedes|también|entonces|después|ahora|siempre|nunca|nada|todo|esto|este|esta|ese|esa|esos|esas|aquel|aquella|suyo|suya|nuestro|nuestra|hacer|hago|hecho|tener|tiene|tengo|tenía|ser|soy|era|fue|ir|va|vamos|voy|ver|veo|dar|doy|quedar|queda|quedó|querer|quiere|quiero|poder|puede|puedo)\b/gi
  ]

  const enIndicators = [
    /\b(the|a|an|is|are|was|were|been|being|have|has|had|having|do|does|did|doing|will|would|could|should|may|might|must|can|this|that|these|those|what|which|who|whom|whose|where|when|why|how|if|then|else|because|although|while|during|before|after|about|between|against|through|with|without|for|from|into|onto|upon|within|among|towards)\b/gi
  ]

  // Conta indicadores
  let ptScore = 0
  let esScore = 0
  let enScore = 0

  for (const pattern of ptIndicators) {
    ptScore += (lowerText.match(pattern) || []).length
  }

  for (const pattern of esIndicators) {
    esScore += (lowerText.match(pattern) || []).length
  }

  for (const pattern of enIndicators) {
    enScore += (lowerText.match(pattern) || []).length
  }

  // Boost para caracteres exclusivos
  if (/[ãõç]/.test(lowerText)) ptScore += 5
  if (/[ñ¿¡]/.test(lowerText)) esScore += 5

  const scores = { pt: ptScore, es: esScore, en: enScore }
  const maxScore = Math.max(ptScore, esScore, enScore)

  let language = 'en'
  if (ptScore === maxScore && ptScore > 0) language = 'pt'
  else if (esScore === maxScore && esScore > 0) language = 'es'
  else if (enScore === maxScore) language = 'en'

  const sortedScores = Object.values(scores).sort((a, b) => b - a)
  const diff = sortedScores[0] - sortedScores[1]
  let confidence = 'low'
  if (diff >= 3 && maxScore >= 3) confidence = 'high'
  else if (diff >= 1 && maxScore >= 2) confidence = 'medium'

  return { language, confidence, scores }
}

/**
 * Gera opções de reply para um tweet COM PESQUISA
 */
export async function generateReplies(tweetText, tweetAuthor, context = {}) {
  const langInfo = detectLanguage(tweetText)

  // NOVA FUNCIONALIDADE: Pesquisa contexto antes de gerar
  let researchContext = null
  if (!context.skipResearch) {
    researchContext = await researchTweet(tweetText, tweetAuthor)
  }

  const languageInstruction = {
    pt: 'Responda em PORTUGUÊS BRASILEIRO',
    es: 'Responda en ESPAÑOL',
    en: 'Reply in ENGLISH'
  }[langInfo.language] || 'Reply in the same language as the tweet'

  // Monta contexto de pesquisa (simplificado para não gerar replies estruturados)
  let researchSection = ''
  if (researchContext?.hasContext) {
    const { topic, research } = researchContext
    // Pega apenas 1-2 fatos relevantes para inspirar, não para listar
    const keyFact = research.facts?.[0] || research.additional_context || ''
    researchSection = `
(Contexto interno - use sutilmente, NÃO liste esses dados):
Tópico: ${topic.topic}. ${keyFact}
`
  }

  // STYLE ROTATION: Escolhe estilo diferente dos últimos usados
  const lastStyles = context.lastStyles || []
  const styleHint = getStyleHint(langInfo.language, lastStyles)
  const styleSection = styleHint ? `
ESTILO SUGERIDO para este reply: "${styleHint.name}"
- ${styleHint.hint}
- Exemplo: "${styleHint.example}"
(Varie os 3 replies, mas priorize este estilo no primeiro)
` : ''

  const userPrompt = `TWEET DE @${tweetAuthor}:
"${tweetText}"
${researchSection}
${context.additionalContext ? `CONTEXTO: ${context.additionalContext}` : ''}
${styleSection}
IDIOMA: ${langInfo.language.toUpperCase()}
${languageInstruction}

Gere 3 replies CURTOS e HUMANOS - cada um com abordagem DIFERENTE:
1. Um que CONCORDA mas adiciona algo
2. Um que traz OUTRO ÂNGULO ou perspectiva diferente
3. Um que QUESTIONA ou mostra ceticismo

REGRAS:
- Pareça uma pessoa real, não uma IA
- NUNCA comece com: ngl, tbh, honestly, actually, na verdade
- Uma ideia por reply, curto e direto
- Casual, como conversa entre amigos

Apenas as 3 opções numeradas:`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: REPLY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }]
    })

    const content = response.content[0].text
    const replies = parseReplies(content)

    return {
      success: true,
      replies,
      language: langInfo.language,
      suggestedStyle: styleHint?.name || null,
      research: researchContext,
      model: response.model,
      usage: response.usage
    }
  } catch (error) {
    console.error('Erro ao gerar replies:', error.message)
    return {
      success: false,
      error: error.message,
      replies: []
    }
  }
}

/**
 * Parseia as 3 opções de reply do texto
 */
function parseReplies(text) {
  const lines = text.split('\n').filter(l => l.trim())
  const replies = []

  for (const line of lines) {
    const match = line.match(/^(\d+)\.\s*(.+)/)
    if (match) {
      let reply = match[2].trim()
      reply = reply.replace(/^["']|["']$/g, '')
      replies.push(reply)
    }
  }

  return replies.slice(0, 3)
}

/**
 * Analisa se um tweet é bom para reply
 */
export async function analyzeTweetPotential(tweet) {
  const prompt = `Analise este tweet para potencial de reply estratégico:

TWEET: "${tweet.text}"
AUTOR: @${tweet.author}
MÉTRICAS: ${tweet.likes || 0} likes, ${tweet.replies || 0} replies, ${tweet.retweets || 0} RTs

Considere:
- É um assunto onde posso demonstrar conhecimento?
- Há espaço para agregar informação nova?
- O autor é relevante na área?

Responda APENAS com um JSON:
{
  "score": 1-10,
  "reasons": ["razão 1", "razão 2"],
  "best_angle": "sugestão de ângulo INFORMATIVO para reply",
  "topic_category": "crypto|stocks|tech|macro|politics|other",
  "skip_reason": null ou "motivo para não responder"
}`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }]
    })

    const content = response.content[0].text
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
    }
    return { score: 5, reasons: ['Análise indisponível'], best_angle: null, skip_reason: null }
  } catch (error) {
    console.error('Erro ao analisar tweet:', error.message)
    return { score: 5, reasons: ['Erro na análise'], best_angle: null, skip_reason: null }
  }
}

export default { generateReplies, detectLanguage, analyzeTweetPotential, getStyleHint, getAvailableStyles }
