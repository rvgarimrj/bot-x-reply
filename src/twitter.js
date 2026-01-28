import crypto from 'crypto'
import 'dotenv/config'

const API_KEY = process.env.X_API_KEY
const API_SECRET = process.env.X_API_KEY_SECRET
const ACCESS_TOKEN = process.env.X_ACCESS_TOKEN
const ACCESS_TOKEN_SECRET = process.env.X_ACCESS_TOKEN_SECRET
const BEARER_TOKEN = process.env.X_BEARER_TOKEN

/**
 * Extrai ID do tweet da URL
 */
export function extractTweetId(url) {
  const match = url.match(/status\/(\d+)/)
  return match ? match[1] : null
}

/**
 * Gera assinatura OAuth 1.0a
 */
function generateOAuthSignature(method, url, params, consumerSecret, tokenSecret) {
  const sortedParams = Object.keys(params).sort().map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&')
  const baseString = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(sortedParams)}`
  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`
  return crypto.createHmac('sha1', signingKey).update(baseString).digest('base64')
}

/**
 * Gera header OAuth 1.0a
 */
function generateOAuthHeader(method, url, extraParams = {}) {
  const oauthParams = {
    oauth_consumer_key: API_KEY,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: ACCESS_TOKEN,
    oauth_version: '1.0',
    ...extraParams
  }

  const signature = generateOAuthSignature(method, url, oauthParams, API_SECRET, ACCESS_TOKEN_SECRET)
  oauthParams.oauth_signature = signature

  const headerParts = Object.keys(oauthParams).sort().map(k => `${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`)
  return `OAuth ${headerParts.join(', ')}`
}

/**
 * Busca tweet pelo ID usando API v2
 */
export async function getTweet(tweetId) {
  const url = `https://api.twitter.com/2/tweets/${tweetId}`
  const params = new URLSearchParams({
    'tweet.fields': 'author_id,created_at,public_metrics,lang',
    'expansions': 'author_id',
    'user.fields': 'username,name'
  })

  try {
    const response = await fetch(`${url}?${params}`, {
      headers: {
        'Authorization': `Bearer ${BEARER_TOKEN}`
      }
    })

    if (!response.ok) {
      const error = await response.text()
      console.error('Erro API X:', response.status, error)
      return null
    }

    const data = await response.json()

    if (!data.data) {
      return null
    }

    const tweet = data.data
    const author = data.includes?.users?.[0]

    return {
      id: tweet.id,
      text: tweet.text,
      author: author?.username || 'unknown',
      authorName: author?.name || '',
      likes: tweet.public_metrics?.like_count || 0,
      replies: tweet.public_metrics?.reply_count || 0,
      retweets: tweet.public_metrics?.retweet_count || 0,
      language: tweet.lang,
      createdAt: tweet.created_at
    }
  } catch (error) {
    console.error('Erro ao buscar tweet:', error.message)
    return null
  }
}

/**
 * Posta um reply em um tweet
 */
export async function postReply(tweetId, replyText) {
  const url = 'https://api.twitter.com/2/tweets'

  const body = {
    text: replyText,
    reply: {
      in_reply_to_tweet_id: tweetId
    }
  }

  try {
    const authHeader = generateOAuthHeader('POST', url)

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const error = await response.text()
      console.error('Erro ao postar reply:', response.status, error)
      return { success: false, error }
    }

    const data = await response.json()
    return { success: true, data }
  } catch (error) {
    console.error('Erro ao postar reply:', error.message)
    return { success: false, error: error.message }
  }
}

/**
 * Dá like em um tweet
 */
export async function likeTweet(tweetId) {
  // Precisa do user ID - vamos buscar primeiro
  const userUrl = 'https://api.twitter.com/2/users/me'

  try {
    const userResponse = await fetch(userUrl, {
      headers: { 'Authorization': `Bearer ${BEARER_TOKEN}` }
    })

    if (!userResponse.ok) return { success: false }

    const userData = await userResponse.json()
    const userId = userData.data.id

    const url = `https://api.twitter.com/2/users/${userId}/likes`
    const authHeader = generateOAuthHeader('POST', url)

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ tweet_id: tweetId })
    })

    return { success: response.ok }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

export default { extractTweetId, getTweet, postReply, likeTweet }
