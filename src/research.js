import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic()

/**
 * Extrai links de um texto
 */
export function extractLinks(text) {
  const urlRegex = /https?:\/\/[^\s]+/g
  const links = text.match(urlRegex) || []
  // Remove t.co links pois são redirects
  return links.filter(link => !link.includes('t.co'))
}

/**
 * Identifica o assunto principal do tweet
 */
export async function identifyTopic(tweetText, tweetAuthor) {
  const prompt = `Analise este tweet e identifique:
1. O ASSUNTO PRINCIPAL (ex: "queda do preço da prata", "rally do Bitcoin", "layoffs em tech")
2. TERMOS DE BUSCA para pesquisar mais sobre isso (3-5 termos específicos)
3. CONTEXTO PROVÁVEL (o que provavelmente está acontecendo)

TWEET de @${tweetAuthor}:
"${tweetText}"

Responda APENAS em JSON:
{
  "topic": "assunto principal em português",
  "topic_en": "main topic in English",
  "search_terms": ["termo1", "termo2", "termo3"],
  "probable_context": "o que provavelmente está acontecendo",
  "category": "crypto|stocks|tech|macro|politics|other"
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
  } catch (error) {
    console.error('Erro ao identificar tópico:', error.message)
  }

  return null
}

/**
 * Pesquisa informações sobre um tópico usando Claude com web search
 */
export async function researchTopic(topic, searchTerms, category) {
  const searchQuery = searchTerms.slice(0, 3).join(' ') + ' ' + new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const prompt = `Você é um pesquisador. Busque informações ATUAIS sobre:

TÓPICO: ${topic}
CATEGORIA: ${category}
TERMOS: ${searchTerms.join(', ')}

Encontre:
1. O QUE ESTÁ ACONTECENDO - fatos recentes e específicos
2. DADOS/NÚMEROS - preços, percentuais, datas
3. CAUSA PROVÁVEL - por que isso está acontecendo
4. CONTEXTO ADICIONAL - informações que agregam valor

Responda em JSON:
{
  "facts": ["fato 1", "fato 2", "fato 3"],
  "data_points": ["dado específico 1", "dado específico 2"],
  "probable_cause": "explicação da causa",
  "additional_context": "contexto que agrega valor",
  "confidence": "high|medium|low"
}`

  try {
    // Usa Claude com capacidade de busca web
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    })

    const content = response.content[0].text
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
    }
  } catch (error) {
    console.error('Erro na pesquisa:', error.message)
  }

  return null
}

/**
 * Faz pesquisa completa sobre um tweet
 */
export async function researchTweet(tweetText, tweetAuthor) {
  console.log('🔍 Pesquisando contexto do tweet...')

  // 1. Identifica o tópico
  const topicInfo = await identifyTopic(tweetText, tweetAuthor)
  if (!topicInfo) {
    console.log('⚠️ Não foi possível identificar o tópico')
    return null
  }

  console.log(`📌 Tópico identificado: ${topicInfo.topic}`)
  console.log(`🔎 Termos de busca: ${topicInfo.search_terms.join(', ')}`)

  // 2. Pesquisa sobre o tópico
  const research = await researchTopic(
    topicInfo.topic_en || topicInfo.topic,
    topicInfo.search_terms,
    topicInfo.category
  )

  if (research) {
    console.log(`✅ Pesquisa concluída (confiança: ${research.confidence})`)
  }

  return {
    topic: topicInfo,
    research: research,
    hasContext: !!research && research.confidence !== 'low'
  }
}

export default { extractLinks, identifyTopic, researchTopic, researchTweet }
