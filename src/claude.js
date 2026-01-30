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
 * Prompt do sistema atualizado para replies informativos
 */
const REPLY_SYSTEM_PROMPT = `Você é um especialista em criar replies estratégicos para o X (Twitter).

PERFIL DO USUÁRIO:
- Username: @${profile.x_username || 'user'}
- Expertise: ${(profile.expertise || []).join(', ')}
- Estilo: ${profile.style || 'informativo e profissional'}
- Abordagem: ${profile.approach?.priority || 'demonstrar conhecimento e agregar valor'}

REGRAS ABSOLUTAS:
1. RESPONDA SEMPRE NO IDIOMA DO TWEET ORIGINAL
2. MÁXIMO 280 caracteres (ideal: 150-200)
3. DEMONSTRE CONHECIMENTO - traga informação que o autor não mencionou
4. TOM: descontraído mas informativo, profissional
5. AGREGUE VALOR REAL - dados, contexto, perspectiva informada

O QUE FAZ UM BOM REPLY:
- Traz INFORMAÇÃO NOVA que complementa o tweet
- Mostra que você PESQUISOU e ENTENDE o assunto
- Adiciona DADOS ou CONTEXTO relevante
- Tom DESCONTRAÍDO mas PROFISSIONAL
- Demonstra EXPERTISE sem ser arrogante

EVITAR A TODO CUSTO:
${(profile.avoid || []).map(a => `- "${a}"`).join('\n')}
- Respostas genéricas que servem para qualquer tweet
- Provocações vazias sem informação
- Perguntas óbvias ("o que é estranho?", "tipo o quê?")
- Repetir o que o tweet já disse
- Bajulação vazia

FORMATO DE SAÍDA:
Retorne EXATAMENTE 3 opções de reply, cada uma em uma linha separada, numeradas:
1. [reply informativo e direto - traz um dado/fato relevante]
2. [reply com contexto adicional - explica o porquê]
3. [reply com perspectiva/análise - sua visão informada]`

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

  // Monta contexto de pesquisa para o prompt
  let researchSection = ''
  if (researchContext?.hasContext) {
    const { topic, research } = researchContext
    researchSection = `
CONTEXTO PESQUISADO:
- Tópico: ${topic.topic}
- Categoria: ${topic.category}
- Contexto provável: ${topic.probable_context}

INFORMAÇÕES ENCONTRADAS:
- Fatos: ${research.facts?.join('; ') || 'N/A'}
- Dados: ${research.data_points?.join('; ') || 'N/A'}
- Causa provável: ${research.probable_cause || 'N/A'}
- Contexto adicional: ${research.additional_context || 'N/A'}

USE ESSAS INFORMAÇÕES para criar replies INFORMATIVOS que demonstrem conhecimento.
`
  }

  const userPrompt = `TWEET DE @${tweetAuthor}:
"${tweetText}"
${researchSection}
${context.additionalContext ? `CONTEXTO DO USUÁRIO: ${context.additionalContext}` : ''}

IDIOMA DETECTADO: ${langInfo.language.toUpperCase()} (${langInfo.confidence})
INSTRUÇÃO: ${languageInstruction}

Gere 3 opções de reply INFORMATIVOS que demonstrem conhecimento do assunto.
Use os dados pesquisados para agregar valor real.
Apenas as 3 opções numeradas, nada mais.`

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

export default { generateReplies, detectLanguage, analyzeTweetPotential }
