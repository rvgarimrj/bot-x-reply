import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

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

const REPLY_SYSTEM_PROMPT = `Você é um especialista em criar replies estratégicos para o X (Twitter).

PERFIL DO USUÁRIO:
- Username: @${profile.x_username || 'user'}
- Expertise: ${(profile.expertise || []).join(', ')}
- Estilo: ${profile.style || 'direto e inteligente'}

REGRAS ABSOLUTAS:
1. RESPONDA SEMPRE NO IDIOMA DO TWEET ORIGINAL
2. MÁXIMO 280 caracteres (ideal: 150-200)
3. AGREGUE VALOR - perspectiva nova, dado interessante, reflexão complementar
4. TOM: direto, inteligente, às vezes provocativo
5. UMA ÚNICA OPINIÃO FORTE - não fique em cima do muro

EVITAR A TODO CUSTO:
${(profile.avoid || []).map(a => `- "${a}"`).join('\n')}
- Repetir o que o tweet disse
- Bajulação vazia
- Perguntas genéricas ("o que você acha?")
- Respostas genéricas que servem para qualquer tweet

BOM REPLY:
- Adiciona perspectiva que o autor não considerou
- Traz experiência pessoal relevante
- Faz conexão inesperada com outro tema
- Desafia respeitosamente uma premissa
- Complementa com dado ou insight

FORMATO DE SAÍDA:
Retorne EXATAMENTE 3 opções de reply, cada uma em uma linha separada, numeradas:
1. [reply mais direto e curto]
2. [reply com perspectiva diferente]
3. [reply mais provocativo/opinativo]`

/**
 * Detecta o idioma do texto
 */
export function detectLanguage(text) {
  const lowerText = text.toLowerCase()

  // Caracteres e padrões exclusivos de cada idioma
  const ptIndicators = [
    /[ãõç]/g,                           // Caracteres exclusivos do PT
    /\b(você|vocês|não|então|também|já|até|depois|porque|porquê|está|estão|são|foi|foram|muito|pouco|aqui|ali|agora|ainda|sempre|nunca|nada|tudo|isso|este|esta|esse|essa|esses|essas|dele|dela|nosso|nossa|seu|sua|meu|minha|fazer|faz|feito|ter|tem|tinha|tenho|ser|sou|era|foi|ir|vai|vamos|vou|ver|vejo|dar|dá|dou|ficar|fica|ficou|querer|quer|quero|poder|pode|posso|dever|deve|devo|precisar|preciso|saber|sei|sabia|achar|acho|achei|pensar|penso|pensei|olhar|olha|olho|falar|falo|falou|dizer|diz|disse|entender|entendo|entendi|trabalhar|trabalho|trabalha|viver|vivo|vida|mundo|tempo|dia|ano|vez|coisa|caso|ponto|parte|forma|modo|lugar|lado|hora|momento|pessoa|gente|homem|mulher|filho|pai|mãe|casa|país|cidade|empresa|governo|estado|problema|questão|exemplo|história|trabalho|projeto|sistema|processo|informação|serviço|resultado|desenvolvimento|tecnologia|mercado|produto|cliente|equipe|área|valor|ideia|objetivo|solução|experiência|qualidade|importante|necessário|possível|diferente|melhor|maior|menor|novo|primeiro|último|próprio|cada|outro|mesmo|todo|alguns|muitos|mais|menos|bem|mal|assim|então|ainda|sempre|nunca|já|aqui|ali|onde|quando|como|porque|porquê|embora|enquanto|durante|antes|depois|sobre|entre|contra|através|mediante)\b/gi
  ]

  const esIndicators = [
    /[ñ¿¡]/g,                           // Caracteres exclusivos do ES
    /\b(usted|ustedes|también|entonces|después|ahora|siempre|nunca|nada|todo|esto|este|esta|ese|esa|esos|esas|aquel|aquella|suyo|suya|nuestro|nuestra|hacer|hago|hecho|tener|tiene|tengo|tenía|ser|soy|era|fue|ir|va|vamos|voy|ver|veo|dar|doy|quedar|queda|quedó|querer|quiere|quiero|poder|puede|puedo|deber|debe|debo|necesitar|necesito|saber|sé|sabía|pensar|pienso|pensé|mirar|mira|miro|hablar|hablo|habló|decir|dice|dijo|entender|entiendo|entendí|trabajar|trabajo|trabaja|vivir|vivo|vida|mundo|tiempo|día|año|vez|cosa|caso|punto|parte|forma|modo|lugar|lado|hora|momento|persona|gente|hombre|mujer|hijo|padre|madre|casa|país|ciudad|empresa|gobierno|estado|problema|cuestión|ejemplo|historia|trabajo|proyecto|sistema|proceso|información|servicio|resultado|desarrollo|tecnología|mercado|producto|cliente|equipo|área|valor|idea|objetivo|solución|experiencia|calidad|importante|necesario|posible|diferente|mejor|mayor|menor|nuevo|primero|último|propio|cada|otro|mismo|todos|algunos|muchos|más|menos|bien|mal|así|entonces|todavía|siempre|nunca|ya|aquí|allí|donde|cuando|como|porque|aunque|mientras|durante|antes|después|sobre|entre|contra|través|mediante)\b/gi
  ]

  const enIndicators = [
    /\b(the|a|an|is|are|was|were|been|being|have|has|had|having|do|does|did|doing|will|would|could|should|may|might|must|can|this|that|these|those|what|which|who|whom|whose|where|when|why|how|if|then|else|because|although|while|during|before|after|about|between|against|through|with|without|for|from|into|onto|upon|within|among|towards|of|to|in|on|at|by|up|down|out|off|over|under|again|further|once|here|there|all|each|every|both|few|more|most|other|some|such|no|nor|not|only|own|same|so|than|too|very|just|also|now|always|never|often|sometimes|usually|already|still|yet|today|tomorrow|yesterday|week|month|year|time|day|thing|people|way|world|life|work|hand|part|place|case|point|fact|group|company|number|problem|system|program|question|government|country|home|school|room|mother|father|child|woman|man|friend|student|teacher|money|business|information|power|service|change|development|market|research|technology|experience|example|result|idea|value|job|area|level|order|process|course|policy|term|data|decision|practice|quality|control|issue|report|support|production|effort|effect|interest|community|action|position|member|management|project|opportunity|health|study|use|need|want|try|see|know|think|take|come|make|get|go|find|give|tell|ask|work|seem|feel|leave|call|keep|let|begin|show|hear|play|run|move|live|believe|hold|bring|happen|write|provide|sit|stand|lose|pay|meet|include|continue|set|learn|lead|understand|watch|follow|stop|create|speak|read|allow|add|spend|grow|open|walk|win|offer|remember|love|consider|appear|buy|wait|serve|die|send|expect|build|stay|fall|cut|reach|kill|remain|suggest|raise|pass|sell|require|produce|receive|claim|concern|mean|represent|rise|discuss|apply|plan|reduce|establish|compare|present|determine|develop|identify|involve|suppose|recognize|explain|announce|accept|challenge|support|join|indicate|replace|improve|manage|maintain|maintain|achieve|obtain|realize|extend|occur|avoid|design|process|introduce|perform|promote|carry|prepare|express|conduct|deliver|propose|review|describe|organize|encourage|define|handle|ensure|continue|attempt|select|generate|seek|demand|complete|contribute|assume|protect|assess|argue|demonstrate|reflect|confirm|investigate|feature|influence|reveal|combine|recommend|focus|operate|implement|explore|acquire|implement)\b/gi
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

  // Boost para caracteres exclusivos (peso extra)
  if (/[ãõç]/.test(lowerText)) ptScore += 5
  if (/[ñ¿¡]/.test(lowerText)) esScore += 5

  const scores = { pt: ptScore, es: esScore, en: enScore }
  const maxScore = Math.max(ptScore, esScore, enScore)

  // Determina idioma
  let language = 'en' // Default
  if (ptScore === maxScore && ptScore > 0) language = 'pt'
  else if (esScore === maxScore && esScore > 0) language = 'es'
  else if (enScore === maxScore) language = 'en'

  // Confiança baseada na diferença entre scores
  const sortedScores = Object.values(scores).sort((a, b) => b - a)
  const diff = sortedScores[0] - sortedScores[1]
  let confidence = 'low'
  if (diff >= 3 && maxScore >= 3) confidence = 'high'
  else if (diff >= 1 && maxScore >= 2) confidence = 'medium'

  return { language, confidence, scores }
}

/**
 * Gera opções de reply para um tweet
 */
export async function generateReplies(tweetText, tweetAuthor, context = {}) {
  const langInfo = detectLanguage(tweetText)

  const languageInstruction = {
    pt: 'Responda em PORTUGUÊS BRASILEIRO',
    es: 'Responda en ESPAÑOL',
    en: 'Reply in ENGLISH'
  }[langInfo.language] || 'Reply in the same language as the tweet'

  const userPrompt = `TWEET DE @${tweetAuthor}:
"${tweetText}"

${context.additionalContext ? `CONTEXTO ADICIONAL: ${context.additionalContext}` : ''}

IDIOMA DETECTADO: ${langInfo.language.toUpperCase()} (${langInfo.confidence})
INSTRUÇÃO: ${languageInstruction}

Gere 3 opções de reply seguindo as regras. Apenas as 3 opções numeradas, nada mais.`

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
    // Procura linhas que começam com 1., 2., 3.
    const match = line.match(/^(\d+)\.\s*(.+)/)
    if (match) {
      let reply = match[2].trim()
      // Remove aspas se presentes
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

Responda APENAS com um JSON:
{
  "score": 1-10,
  "reasons": ["razão 1", "razão 2"],
  "best_angle": "sugestão de ângulo para reply",
  "skip_reason": null ou "motivo para não responder"
}`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }]
    })

    const content = response.content[0].text
    // Extrai JSON do texto
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
