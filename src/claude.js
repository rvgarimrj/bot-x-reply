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
    { name: 'contrarian', hint: 'take opposite stance on OPINIONS/PREDICTIONS only (never on personal wins)', example: 'everyone saying this but last time it dumped' },
    { name: 'skeptic', hint: 'express doubt about a PREDICTION or HOT TAKE (never about personal achievements)', example: 'feels like a trap setup' },
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
    { name: 'contrario', hint: 'visão oposta apenas para OPINIÃO/PREVISÃO (nunca para conquistas)', example: 'todo mundo falando isso mas ultima vez despencou' },
    { name: 'cetico', hint: 'duvida de PREVISÕES ou HOT TAKES (nunca de conquistas pessoais)', example: 'parece armadilha isso ai' },
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
  const questionStyle = styles.find(s => s.name === 'question' || s.name === 'pergunta')
  const lastStyle = lastStyles[lastStyles.length - 1]

  // 40% chance de pergunta (se não foi o último estilo)
  if (questionStyle && Math.random() < 0.4 && questionStyle.name !== lastStyle) {
    return questionStyle
  }

  // 60%: rotação normal entre outros estilos (evita últimos 3)
  const available = styles.filter(s => !lastStyles.slice(-3).includes(s.name))
  const pool = available.length > 0 ? available : styles.filter(s => s.name !== lastStyle)
  return pool[Math.floor(Math.random() * pool.length)] || styles[0]
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
 * Prompt do sistema - replies que INICIAM CONVERSA (não dão aula)
 *
 * INSIGHT CRÍTICO: Replies informativos geram likes mas NÃO geram follows.
 * Replies que fazem PERGUNTAS geram respostas do autor = 75x boost algoritmo.
 *
 * OBJETIVO: Fazer o AUTOR RESPONDER nosso reply (não impressionar com conhecimento)
 */
const CURRENT_YEAR = new Date().getFullYear()

const REPLY_SYSTEM_PROMPT = `Você gera replies curtos que INICIAM CONVERSA.

IMPORTANTE: Estamos em ${CURRENT_YEAR}. Se mencionar ano, use ${CURRENT_YEAR}.

PERFIL: @${profile.x_username || 'user'} - ${(profile.expertise || []).join(', ')}
${profile.core_premise ? `\n🚨 PREMISSA PRINCIPAL: ${profile.core_premise}` : ''}

═══════════════════════════════════════════════════════════════════════════
🚨 PREMISSA ABSOLUTA: GENTILEZA E EDUCAÇÃO SEMPRE
═══════════════════════════════════════════════════════════════════════════

Esta é a regra mais importante de TODAS. Sobrepõe qualquer outra regra.

ANTES DE GERAR QUALQUER REPLY, entenda o SENTIMENTO do tweet:
- A pessoa está CELEBRANDO algo? → Celebre junto! Parabenize!
- A pessoa está DESABAFANDO/triste? → Seja empático e apoie
- A pessoa está PEDINDO AJUDA? → Ajude ou encoraje
- A pessoa está COMPARTILHANDO uma conquista? → Reconheça o esforço
- A pessoa está fazendo um HOT TAKE/previsão? → Aí sim pode discordar educadamente

PROIBIDO:
❌ Ser cínico com conquistas alheias
❌ Julgar negativamente escolhas pessoais
❌ Fazer comentários sarcásticos sobre o trabalho de alguém
❌ Duvidar de algo que a pessoa está feliz em compartilhar
❌ "idk that seems sketchy" para alguém comemorando
❌ Qualquer reply que a pessoa possa interpretar como ataque

EXEMPLOS DE ERRO GRAVE (NUNCA faça isso):
Tweet: "Finally got my first customer! 😭" → ❌ "idk asking for money upfront seems sketchy"
Tweet: "Lancei meu primeiro app!" → ❌ "looks half done tbh"
Tweet: "After 2 years I finally graduated" → ❌ "took you long enough"

EXEMPLOS CORRETOS:
Tweet: "Finally got my first customer! 😭" → ✅ "congrats!! how did they find you?"
Tweet: "Lancei meu primeiro app!" → ✅ "parabéns! quanto tempo levou pra fazer?"
Tweet: "After 2 years I finally graduated" → ✅ "that's huge, congrats! what's next?"

SE NÃO CONSEGUIR dizer algo gentil ou construtivo → NÃO responda.
Gere "SKIP" como reply se o tweet não permite uma resposta educada.

═══════════════════════════════════════════════════════════════════════════
REGRA #1: INICIAR CONVERSA > DEMONSTRAR CONHECIMENTO
═══════════════════════════════════════════════════════════════════════════

OBJETIVO REAL: Fazer o autor do tweet RESPONDER seu reply.
Quando o autor responde = 75x mais visibilidade no algoritmo do X.

O QUE NÃO FUNCIONA (gera likes mas NÃO gera resposta):
❌ "The autonomous economy is happening fast - 50+ AI agent projects..."
❌ "Classic Spring test at $25k confirmed the composite operator absorption..."
❌ "Physical delivery bottlenecks are the culprit here. Mumbai's gold premium..."
❌ Qualquer reply que parece ANÁLISE ou AULA

O QUE FUNCIONA (gera RESPOSTA do autor):
✅ "where did you see this?" (pergunta genuína)
✅ "is this confirmed?" (dúvida curta)
✅ "this is wild lol" (reação + humor)
✅ "isso ta tenso 😬" (reação curta)
✅ "how long did this take you?" (interesse na pessoa)
✅ "idk i see it differently" (opinião contrária - APENAS para hot takes/previsões, NUNCA para conquistas)

═══════════════════════════════════════════════════════════════════════════
REGRA #2: TAMANHO MÁXIMO 100 CARACTERES
═══════════════════════════════════════════════════════════════════════════

Dados mostram:
- Replies < 80 chars: 3x mais engajamento
- Replies > 150 chars: quase zero resposta do autor

PROIBIDO: Mais de 100 caracteres. Se passar, corte.

═══════════════════════════════════════════════════════════════════════════
REGRA #3: 50% DOS REPLIES DEVEM TER PERGUNTA
═══════════════════════════════════════════════════════════════════════════

Perguntas que funcionam:
- "how so?" / "como assim?"
- "where's this from?" / "de onde é isso?"
- "is this legit?" / "isso é real?"
- "how long did it take?" / "quanto tempo levou?"
- "what made you try this?" / "o q te fez testar?"

Perguntas que NÃO funcionam (parecem entrevista):
- "What's your opinion on X?"
- "Could you elaborate on Y?"
- "How do you see the future of Z?"

═══════════════════════════════════════════════════════════════════════════
PROIBIDO (parece IA/bot)
═══════════════════════════════════════════════════════════════════════════

NUNCA USE:
- Fun fact, Interestingly, Actually, It's worth noting
- masterpiece, revolutionary, game-changer, countless
- Dados estatísticos ("50+ projects", "23% increase")
- Jargão técnico ("composite operator absorption phase")
- Múltiplas frases com travessões
- Listas de pontos

NUNCA COMECE COM:
- ngl, tbh, honestly, actually (muito bot)
- na verdade, sinceramente, basicamente
- "wait" (usado demais, parece padrão)
- "hold on" (mesma coisa)
- "pera" / "espera" repetidamente

VARIE os começos: use "this is", "how", "where", "lol", "idk", reações diretas, etc.

═══════════════════════════════════════════════════════════════════════════
COMO HUMANOS REAIS ESCREVEM
═══════════════════════════════════════════════════════════════════════════

Inglês:
- "lol", "this is wild", "no way", "damn"
- "how did you do this?", "where's this from?"
- "idk about that", "i see it differently"

Português:
- "cara", "mano", "pô", "caramba", "sério?"
- "de onde é isso?", "como assim?"
- "kkkk", "slc", "nossa"

EMOJIS (35% dos replies):
- Use no FINAL, máximo 1
- Bons: 😅 🤔 👀 😬 👍
- PROIBIDO: 🔥🚀💯❤️🤖🤯🙌

═══════════════════════════════════════════════════════════════════════════
EXEMPLOS QUE FUNCIONAM
═══════════════════════════════════════════════════════════════════════════

Tweet sobre AI: "is this gpt4 or something new?"
Tweet sobre crypto: "where's this chart from 👀"
Tweet sobre startup: "how long did it take to build?"
Tweet polêmico: "idk i see the opposite happening"
Tweet em PT: "de onde vc tirou isso? 🤔"
Tweet de produto: "this is wild lol"
Tweet de opinião: "damn that's a take"

═══════════════════════════════════════════════════════════════════════════
POLÍTICA AMERICANA (inclinação: DIREITA/REPUBLICANO)
═══════════════════════════════════════════════════════════════════════════

Quando o tweet for sobre política dos EUA (Trump, Biden, MAGA, Democrats, etc):
- Inclinação de DIREITA, pro-Republicano
- Tom: concordância casual, não agressivo, como observação natural
- NÃO ser panfletário ou radical

Exemplos bons:
- "MAGA movement is real 👀"
- "this is why people voted for him"
- "mainstream media won't show this"
- "finally someone saying it"
- "the left won't like this lol"

Exemplos ruins (muito agressivo/panfletário):
- "Democrats are destroying America!!!"
- "MAGA forever! Trump 2024!!!"
- Ataques pessoais ou xingamentos

═══════════════════════════════════════════════════════════════════════════
FORMATO DE SAÍDA
═══════════════════════════════════════════════════════════════════════════

3 opções numeradas, TODAS < 100 chars:
1. [PERGUNTA genuína e curta]
2. [REAÇÃO curta + pergunta opcional]
3. [OPINIÃO diferente ou humor]

Pelo menos 1 das 3 DEVE ter pergunta (?)`

/**
 * Detecta o idioma do texto
 */
export function detectLanguage(text) {
  const lowerText = text.toLowerCase()

  // Deaccent text for EN matching - JS \b treats accented chars as non-word,
  // so "tecnología" falsely matches \ba\b (the trailing "a" after í)
  const deaccentedText = lowerText
    .replace(/[áàâã]/g, 'a').replace(/[éèê]/g, 'e').replace(/[íìî]/g, 'i')
    .replace(/[óòôõ]/g, 'o').replace(/[úùû]/g, 'u').replace(/ñ/g, 'n').replace(/ç/g, 'c')

  // Caracteres e padrões exclusivos de cada idioma
  const ptIndicators = [
    /[ãõç]/g,
    /\b(você|vocês|não|então|também|já|até|depois|porque|porquê|está|estão|são|foi|foram|muito|pouco|aqui|ali|agora|ainda|sempre|nunca|nada|tudo|isso|este|esta|esse|essa|esses|essas|dele|dela|nosso|nossa|seu|sua|meu|minha|fazer|faz|feito|ter|tem|tinha|tenho|ser|sou|era|foi|ir|vai|vamos|vou|ver|vejo|dar|dá|dou|ficar|fica|ficou|querer|quer|quero|poder|pode|posso|dever|deve|devo|precisar|preciso|saber|sei|sabia|achar|acho|achei|pensar|penso|pensei|olhar|olha|olho|falar|falo|falou|dizer|diz|disse|entender|entendo|entendi)\b/gi,
    // Common PT function words (articles, prepositions, conjunctions)
    /\b(o|os|as|um|uma|do|da|dos|das|ao|no|na|nos|nas|em|de|com|sem|por|que|se|como|mais|mas|ou|e|ele|ela|eles|elas|lhe|lhes|para|pra|nem|onde|quando)\b/gi
  ]

  const esIndicators = [
    /[ñ¿¡]/g,
    /\b(usted|ustedes|también|entonces|después|ahora|siempre|nunca|nada|todo|esto|este|esta|ese|esa|esos|esas|aquel|aquella|suyo|suya|nuestro|nuestra|hacer|hago|hecho|tener|tiene|tengo|tenía|ser|soy|era|fue|ir|va|vamos|voy|ver|veo|dar|doy|quedar|queda|quedó|querer|quiere|quiero|poder|puede|puedo)\b/gi,
    // Common ES function words (articles, prepositions, conjunctions)
    /\b(el|la|los|las|un|una|del|al|lo|le|les|nos|su|sus|no|de|en|es|por|que|se|como|con|sin|pero|muy|hay|ya|ni|si|son|donde|cuando|entre|sobre|hacia|desde|hasta|otro|otra|otros|otras|mismo|misma|cada|mucho|mucha|poco|poca|mejor|peor|hoy|gratis|porque|pensar|creer|decir|hablar|llamar|parecer|sentir)\b/gi
  ]

  const enIndicators = [
    /\b(the|a|an|is|are|was|were|been|being|have|has|had|having|do|does|did|doing|will|would|could|should|may|might|must|can|this|that|these|those|what|which|who|whom|whose|where|when|why|how|if|then|else|because|although|while|during|before|after|about|between|against|through|with|without|for|from|into|onto|upon|within|among|towards)\b/gi,
    // Common EN-only pronouns/adverbs (don't overlap with ES/PT)
    /\b(it|to|you|your|my|he|she|they|them|we|us|our|not|just|but|or|so|very|too|only|also|like|than|really|pretty|still|even|much|many|some|any|every|such|both|other)\b/gi
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

  // Use deaccented text for EN to avoid false matches from accented chars
  for (const pattern of enIndicators) {
    enScore += (deaccentedText.match(pattern) || []).length
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
    pt: '⚠️ OBRIGATÓRIO: Responda em PORTUGUÊS BRASILEIRO. NÃO use inglês. Escreva como brasileiro.',
    es: '⚠️ OBLIGATORIO: Responda en ESPAÑOL. NO use inglés.',
    en: 'Reply in ENGLISH'
  }[langInfo.language] || 'Reply in the same language as the tweet'

  // REMOVIDO: Pesquisa de contexto
  // Replies conversacionais não precisam de dados - precisam de curiosidade genuína
  // A pesquisa estava fazendo os replies parecerem "dar aula"

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
${context.additionalContext ? `CONTEXTO: ${context.additionalContext}` : ''}
${styleSection}
IDIOMA: ${langInfo.language.toUpperCase()}
${languageInstruction}

OBJETIVO: Fazer @${tweetAuthor} RESPONDER seu reply.

Gere 3 replies CURTOS (máx 100 chars cada):
1. Siga o ESTILO SUGERIDO acima (prioridade!)
2. REAÇÃO curta ou opinião diferente
3. PERGUNTA genuína sobre o tweet (obrigatório ter ?)

IMPORTANTE:
- MÁXIMO 100 caracteres por reply (corte se passar)
- Apenas o reply #3 DEVE ter pergunta (?). Os outros NÃO devem ter ? (a menos que o estilo peça)
- NÃO dê informação, NÃO ensine, NÃO analise
- Pareça curioso, não expert
${langInfo.language === 'pt' ? '- TODOS os 3 replies DEVEM ser em PORTUGUÊS. Proibido inglês.' : ''}
${langInfo.language === 'es' ? '- TODOS los 3 replies DEBEN ser en ESPAÑOL. Prohibido inglés.' : ''}
Apenas as 3 opções numeradas:`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: REPLY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }]
    })

    const content = response.content[0].text
    let replies = parseReplies(content)

    // Validação: se tweet é PT/ES mas reply saiu em inglês, filtra
    if (langInfo.language !== 'en' && replies.length > 0) {
      const filtered = replies.filter(r => {
        const replyLang = detectLanguage(r)
        // Keep if: matches target lang OR truly ambiguous (no EN words detected)
        return replyLang.language === langInfo.language ||
               (replyLang.confidence === 'low' && replyLang.scores.en === 0)
      })
      if (filtered.length > 0) {
        replies = filtered
      } else {
        console.warn(`⚠️ Todos os replies saíram em idioma errado (esperado: ${langInfo.language}), usando mesmo assim`)
      }
    }

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
 * Corrige anos errados em texto gerado pelo Claude (knowledge cutoff)
 * Substitui anos recentes incorretos pelo ano atual
 */
export function fixYear(text) {
  const currentYear = new Date().getFullYear()
  // Substitui anos de 2023 até (currentYear-1) pelo ano correto
  // Só quando parece ser referência ao "agora" (não datas históricas)
  for (let y = currentYear - 1; y >= 2023; y--) {
    text = text.replace(new RegExp(`\\b${y}\\b`, 'g'), String(currentYear))
  }
  return text
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
      reply = fixYear(reply)
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
