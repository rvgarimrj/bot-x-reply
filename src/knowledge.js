import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const DATA_DIR = join(__dirname, '../data')
const KNOWLEDGE_FILE = join(DATA_DIR, 'knowledge.json')

// Garante que o diretório existe
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true })
}

/**
 * Estrutura da base de conhecimento
 */
const defaultKnowledge = {
  // Replies postados e seus resultados
  replies: [],

  // Padrões que funcionam bem
  patterns: {
    highEngagement: [],  // Frases/estruturas que deram bom resultado
    lowEngagement: [],   // O que evitar
    bestTopics: [],      // Tópicos com melhor performance
    bestTones: []        // Tons que funcionam
  },

  // Estatísticas gerais
  stats: {
    totalReplies: 0,
    avgLikes: 0,
    avgReplies: 0,
    bestReply: null,
    worstReply: null
  },

  // Insights aprendidos (gerados por análise)
  insights: [],

  // Última atualização
  lastUpdated: null
}

/**
 * Carrega a base de conhecimento
 */
export function loadKnowledge() {
  try {
    if (existsSync(KNOWLEDGE_FILE)) {
      const data = JSON.parse(readFileSync(KNOWLEDGE_FILE, 'utf-8'))
      return { ...defaultKnowledge, ...data }
    }
  } catch (e) {
    console.warn('Erro ao carregar knowledge base:', e.message)
  }
  return { ...defaultKnowledge }
}

/**
 * Salva a base de conhecimento
 */
export function saveKnowledge(knowledge) {
  knowledge.lastUpdated = new Date().toISOString()
  writeFileSync(KNOWLEDGE_FILE, JSON.stringify(knowledge, null, 2))
}

/**
 * Registra um reply postado
 */
export function recordPostedReply(data) {
  const knowledge = loadKnowledge()

  const entry = {
    id: Date.now().toString(),
    timestamp: new Date().toISOString(),
    tweetUrl: data.tweetUrl,
    tweetAuthor: data.tweetAuthor,
    tweetText: data.tweetText,
    replyText: data.replyText,
    replyIndex: data.replyIndex, // Qual opção foi escolhida (1, 2, 3)
    wasRecommended: data.wasRecommended, // Se era o recomendado
    // Métricas (preenchidas depois)
    metrics: {
      likes: null,
      replies: null,
      impressions: null,
      checkedAt: null
    },
    // Análise
    analysis: {
      tone: data.tone || null,
      topics: data.topics || [],
      length: data.replyText?.length || 0
    }
  }

  knowledge.replies.push(entry)
  knowledge.stats.totalReplies++

  saveKnowledge(knowledge)
  return entry.id
}

/**
 * Atualiza métricas de um reply (após verificar engajamento)
 */
export function updateReplyMetrics(replyId, metrics) {
  const knowledge = loadKnowledge()

  const reply = knowledge.replies.find(r => r.id === replyId)
  if (reply) {
    reply.metrics = {
      ...metrics,
      checkedAt: new Date().toISOString()
    }

    // Recalcula estatísticas
    recalculateStats(knowledge)

    // Atualiza padrões baseado no resultado
    updatePatterns(knowledge, reply)

    saveKnowledge(knowledge)
  }
}

/**
 * Recalcula estatísticas gerais
 */
function recalculateStats(knowledge) {
  const repliesWithMetrics = knowledge.replies.filter(r => r.metrics?.likes !== null)

  if (repliesWithMetrics.length === 0) return

  const totalLikes = repliesWithMetrics.reduce((sum, r) => sum + (r.metrics.likes || 0), 0)
  const totalReplies = repliesWithMetrics.reduce((sum, r) => sum + (r.metrics.replies || 0), 0)

  knowledge.stats.avgLikes = Math.round(totalLikes / repliesWithMetrics.length)
  knowledge.stats.avgReplies = Math.round(totalReplies / repliesWithMetrics.length)

  // Melhor reply
  const sorted = [...repliesWithMetrics].sort((a, b) =>
    (b.metrics.likes + b.metrics.replies * 2) - (a.metrics.likes + a.metrics.replies * 2)
  )

  if (sorted.length > 0) {
    knowledge.stats.bestReply = {
      text: sorted[0].replyText,
      likes: sorted[0].metrics.likes,
      replies: sorted[0].metrics.replies
    }
    knowledge.stats.worstReply = {
      text: sorted[sorted.length - 1].replyText,
      likes: sorted[sorted.length - 1].metrics.likes,
      replies: sorted[sorted.length - 1].metrics.replies
    }
  }
}

/**
 * Atualiza padrões baseado nos resultados
 */
function updatePatterns(knowledge, reply) {
  const score = (reply.metrics.likes || 0) + (reply.metrics.replies || 0) * 2
  const avgScore = knowledge.stats.avgLikes + knowledge.stats.avgReplies * 2

  // Extrai características do reply
  const features = extractFeatures(reply.replyText)

  if (score > avgScore * 1.5) {
    // Reply muito bom - adiciona aos padrões positivos
    knowledge.patterns.highEngagement.push({
      text: reply.replyText,
      features,
      score,
      date: reply.timestamp
    })

    // Mantém só os 20 melhores
    knowledge.patterns.highEngagement = knowledge.patterns.highEngagement
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)

  } else if (score < avgScore * 0.5 && avgScore > 0) {
    // Reply ruim - adiciona aos padrões negativos
    knowledge.patterns.lowEngagement.push({
      text: reply.replyText,
      features,
      score,
      date: reply.timestamp
    })

    // Mantém só os 10 últimos
    knowledge.patterns.lowEngagement = knowledge.patterns.lowEngagement.slice(-10)
  }
}

/**
 * Extrai características de um texto
 */
function extractFeatures(text) {
  if (!text) return {}

  return {
    length: text.length,
    hasQuestion: text.includes('?'),
    hasEmoji: /[\u{1F300}-\u{1F9FF}]/u.test(text),
    startsWithI: /^(I |Eu |Yo )/i.test(text),
    isProvocative: /\b(wrong|errado|never|nunca|actually|na verdade)\b/i.test(text),
    hasData: /\d+%|\d+ (years|anos|people|pessoas)/.test(text),
    tone: detectTone(text)
  }
}

/**
 * Detecta o tom do texto
 */
function detectTone(text) {
  const lower = text.toLowerCase()

  if (/\b(wrong|disagree|but|however|actually)\b/.test(lower)) return 'contrarian'
  if (/\b(great|amazing|love|exactly|agree)\b/.test(lower)) return 'supportive'
  if (/\?$/.test(text)) return 'questioning'
  if (/!$/.test(text)) return 'emphatic'
  if (/\b(data|research|study|evidence)\b/.test(lower)) return 'analytical'

  return 'neutral'
}

/**
 * Gera contexto para o Claude baseado no conhecimento
 */
export function getKnowledgeContext() {
  const knowledge = loadKnowledge()

  if (knowledge.replies.length < 3) {
    return null // Pouco dado ainda
  }

  let context = ''

  // Estatísticas
  if (knowledge.stats.totalReplies > 0) {
    context += `\n\nESTATÍSTICAS DOS MEUS REPLIES ANTERIORES:\n`
    context += `- Total postados: ${knowledge.stats.totalReplies}\n`
    context += `- Média de likes: ${knowledge.stats.avgLikes}\n`
    context += `- Média de replies: ${knowledge.stats.avgReplies}\n`
  }

  // Melhores padrões
  if (knowledge.patterns.highEngagement.length > 0) {
    context += `\nEXEMPLOS DE REPLIES QUE FUNCIONARAM BEM:\n`
    knowledge.patterns.highEngagement.slice(0, 3).forEach(p => {
      context += `- "${p.text}" (${p.score} engajamento)\n`
    })
  }

  // O que evitar
  if (knowledge.patterns.lowEngagement.length > 0) {
    context += `\nEVITAR ESTE ESTILO (baixo engajamento):\n`
    knowledge.patterns.lowEngagement.slice(0, 2).forEach(p => {
      context += `- "${p.text}"\n`
    })
  }

  // Insights
  if (knowledge.insights.length > 0) {
    context += `\nINSIGHTS APRENDIDOS:\n`
    knowledge.insights.slice(-5).forEach(i => {
      context += `- ${i}\n`
    })
  }

  return context || null
}

/**
 * Analisa qual reply é o melhor baseado no conhecimento
 */
export function recommendBestReply(replies, tweetContext = {}) {
  const knowledge = loadKnowledge()

  // Se não tem dados suficientes, recomenda o primeiro (mais direto)
  if (knowledge.replies.length < 5) {
    return {
      index: 0,
      reason: 'Primeira opção (mais direta e concisa)',
      confidence: 'low'
    }
  }

  // Analisa cada reply
  const scores = replies.map((reply, index) => {
    let score = 0
    const features = extractFeatures(reply)

    // Compara com padrões de sucesso
    for (const pattern of knowledge.patterns.highEngagement) {
      // Similaridade de tom
      if (pattern.features?.tone === features.tone) score += 10
      // Similaridade de tamanho
      if (Math.abs((pattern.features?.length || 0) - features.length) < 50) score += 5
      // Mesmas características
      if (pattern.features?.hasQuestion === features.hasQuestion) score += 3
      if (pattern.features?.isProvocative === features.isProvocative) score += 5
    }

    // Penaliza padrões de fracasso
    for (const pattern of knowledge.patterns.lowEngagement) {
      if (pattern.features?.tone === features.tone) score -= 8
    }

    // Bonus por características geralmente boas
    if (features.isProvocative) score += 5 // Replies provocativos costumam engajar
    if (features.hasData) score += 3 // Dados aumentam credibilidade
    if (features.length > 100 && features.length < 200) score += 3 // Tamanho ideal

    return { index, score, features }
  })

  // Ordena por score
  scores.sort((a, b) => b.score - a.score)

  const best = scores[0]
  const confidence = best.score > 20 ? 'high' : best.score > 10 ? 'medium' : 'low'

  // Gera razão
  let reason = 'Melhor match com padrões de sucesso'
  if (best.features.isProvocative) reason = 'Tom provocativo (historicamente engaja mais)'
  else if (best.features.hasData) reason = 'Contém dados/evidências'
  else if (best.features.tone === 'contrarian') reason = 'Perspectiva contrária (gera discussão)'

  return {
    index: best.index,
    reason,
    confidence,
    scores: scores.map(s => ({ index: s.index, score: s.score }))
  }
}

/**
 * Adiciona um insight manual
 */
export function addInsight(insight) {
  const knowledge = loadKnowledge()
  knowledge.insights.push(insight)
  // Mantém só os 20 últimos
  knowledge.insights = knowledge.insights.slice(-20)
  saveKnowledge(knowledge)
}

/**
 * Retorna resumo do conhecimento
 */
export function getKnowledgeSummary() {
  const knowledge = loadKnowledge()
  return {
    totalReplies: knowledge.stats.totalReplies,
    avgLikes: knowledge.stats.avgLikes,
    avgReplies: knowledge.stats.avgReplies,
    bestReply: knowledge.stats.bestReply,
    patternsLearned: knowledge.patterns.highEngagement.length,
    insightsCount: knowledge.insights.length,
    lastUpdated: knowledge.lastUpdated
  }
}

/**
 * Retorna lista de URLs de tweets que já respondemos
 * Usado para filtrar sugestões e não sugerir tweets repetidos
 * Considera apenas últimos 6 meses (tweets antigos não aparecem nas sugestões)
 */
export function getRepliedTweetUrls() {
  const knowledge = loadKnowledge()
  const sixMonthsAgo = Date.now() - (180 * 24 * 60 * 60 * 1000)

  return knowledge.replies
    .filter(r => new Date(r.timestamp).getTime() > sixMonthsAgo)
    .map(r => r.tweetUrl)
    .filter(url => url) // Remove nulls
}

/**
 * Limpa dados antigos da base de conhecimento
 * Mantém apenas últimos 6 meses para não crescer infinitamente
 */
export function cleanOldData() {
  const knowledge = loadKnowledge()
  const sixMonthsAgo = Date.now() - (180 * 24 * 60 * 60 * 1000)

  const oldCount = knowledge.replies.length
  knowledge.replies = knowledge.replies.filter(r =>
    new Date(r.timestamp).getTime() > sixMonthsAgo
  )

  const removed = oldCount - knowledge.replies.length
  if (removed > 0) {
    console.log(`🧹 Removidos ${removed} replies antigos da base de conhecimento`)
    recalculateStats(knowledge)
    saveKnowledge(knowledge)
  }

  return removed
}

export default {
  loadKnowledge,
  saveKnowledge,
  recordPostedReply,
  updateReplyMetrics,
  getKnowledgeContext,
  recommendBestReply,
  addInsight,
  getKnowledgeSummary,
  getRepliedTweetUrls,
  cleanOldData
}
