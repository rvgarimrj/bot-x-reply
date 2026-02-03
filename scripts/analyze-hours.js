#!/usr/bin/env node

/**
 * Análise de horários de maior engajamento
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const KNOWLEDGE_PATH = path.join(__dirname, '..', 'data', 'knowledge.json')

const knowledge = JSON.parse(fs.readFileSync(KNOWLEDGE_PATH, 'utf-8'))
const replies = knowledge.replies || []

// Análise por hora
const byHour = {}
const byDayOfWeek = {}

for (const reply of replies) {
  if (!reply.timestamp) continue
  const date = new Date(reply.timestamp)
  const hour = date.getHours()
  const day = date.getDay()

  if (!byHour[hour]) byHour[hour] = { count: 0, likes: 0, authorReplies: 0 }
  byHour[hour].count++
  if (reply.metrics?.likes) byHour[hour].likes += reply.metrics.likes
  if (reply.metrics?.authorReplied) byHour[hour].authorReplies++

  if (!byDayOfWeek[day]) byDayOfWeek[day] = { count: 0, likes: 0, authorReplies: 0 }
  byDayOfWeek[day].count++
  if (reply.metrics?.likes) byDayOfWeek[day].likes += reply.metrics.likes
  if (reply.metrics?.authorReplied) byDayOfWeek[day].authorReplies++
}

console.log('=== PERFORMANCE POR HORA (GMT-3 / Horário de Brasília) ===\n')
console.log('Hora | Replies | Likes | Avg | AuthorReplies')
console.log('-----|---------|-------|-----|---------------')
Object.entries(byHour)
  .sort((a,b) => parseInt(a[0]) - parseInt(b[0]))
  .forEach(([hour, data]) => {
    const avgLikes = data.count > 0 ? (data.likes / data.count).toFixed(1) : '0.0'
    const h = String(hour).padStart(2, ' ') + 'h'
    console.log(`${h}   | ${String(data.count).padStart(7)} | ${String(data.likes).padStart(5)} | ${avgLikes.padStart(3)} | ${data.authorReplies}`)
  })

console.log('\n=== PERFORMANCE POR DIA DA SEMANA ===\n')
const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab']
console.log('Dia | Replies | Likes | Avg')
console.log('----|---------|-------|-----')
Object.entries(byDayOfWeek)
  .sort((a,b) => parseInt(a[0]) - parseInt(b[0]))
  .forEach(([day, data]) => {
    const avgLikes = data.count > 0 ? (data.likes / data.count).toFixed(1) : '0.0'
    console.log(`${dias[day]} | ${String(data.count).padStart(7)} | ${String(data.likes).padStart(5)} | ${avgLikes}`)
  })

console.log('\n=== RESUMO ===')
console.log('Total replies:', replies.length)
console.log('Com métricas:', replies.filter(r => r.metrics?.likes !== null && r.metrics?.likes !== undefined).length)

// Encontra melhores horários
const hoursWithData = Object.entries(byHour)
  .filter(([_, data]) => data.count >= 3)
  .map(([hour, data]) => ({
    hour: parseInt(hour),
    avgLikes: data.count > 0 ? data.likes / data.count : 0,
    authorReplyRate: data.count > 0 ? (data.authorReplies / data.count) * 100 : 0
  }))
  .sort((a, b) => b.avgLikes - a.avgLikes)

if (hoursWithData.length > 0) {
  console.log('\n=== MELHORES HORÁRIOS (por avg likes) ===')
  hoursWithData.slice(0, 5).forEach((h, i) => {
    console.log(`${i+1}. ${h.hour}h - avg ${h.avgLikes.toFixed(1)} likes, ${h.authorReplyRate.toFixed(0)}% author replies`)
  })
}
