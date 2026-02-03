#!/usr/bin/env node

/**
 * Session Context - Gera contexto para Claude no início de cada sessão
 *
 * Este script é chamado pelo hook SessionStart e fornece:
 * - Status atual do daemon
 * - Estatísticas recentes
 * - Insights e recomendações pendentes
 * - Próximos passos sugeridos
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function loadJSON(filepath) {
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf-8'))
  } catch {
    return null
  }
}

function checkDaemon() {
  try {
    const result = execSync('pgrep -f "auto-daemon.js"', { encoding: 'utf-8' })
    return result.trim().length > 0
  } catch {
    return false
  }
}

function main() {
  const learningsPath = path.join(__dirname, '..', 'data', 'learnings.json')
  const knowledgePath = path.join(__dirname, '..', 'data', 'knowledge.json')
  const statePath = path.join(__dirname, '..', '.auto-daemon-state.json')

  const learnings = loadJSON(learningsPath)
  const knowledge = loadJSON(knowledgePath)
  const state = loadJSON(statePath)

  console.log('# [Bot-X-Reply] Contexto da Sessão')
  console.log('')

  // Status do daemon
  const daemonRunning = checkDaemon()
  console.log(`## Status`)
  console.log(`- Daemon: ${daemonRunning ? '✅ Rodando' : '❌ Parado'}`)

  if (state?.lastReplyTime) {
    const lastReply = new Date(state.lastReplyTime)
    const minAgo = Math.round((Date.now() - lastReply.getTime()) / 60000)
    console.log(`- Último reply: ${minAgo} min atrás`)
  }

  // Estatísticas
  if (knowledge?.replies) {
    const today = new Date().toDateString()
    const todaysReplies = knowledge.replies.filter(r =>
      new Date(r.timestamp).toDateString() === today
    ).length
    console.log(`- Replies hoje: ${todaysReplies}`)
    console.log(`- Total histórico: ${knowledge.replies.length}`)
  }

  // Learning System
  if (learnings) {
    console.log('')
    console.log('## Aprendizados')

    if (learnings.lastAnalysis) {
      const lastAnalysis = new Date(learnings.lastAnalysis)
      const hoursAgo = Math.round((Date.now() - lastAnalysis.getTime()) / 3600000)
      console.log(`- Última análise: ${hoursAgo}h atrás`)
    }

    // Insights recentes
    const recentInsights = (learnings.insights || []).slice(-3)
    if (recentInsights.length > 0) {
      console.log('')
      console.log('### Insights Recentes')
      for (const insight of recentInsights) {
        const icon = insight.type === 'success' ? '✅' : insight.type === 'warning' ? '⚠️' : 'ℹ️'
        console.log(`${icon} ${insight.message}`)
      }
    }

    // Recomendações pendentes
    if (learnings.recommendations?.length > 0) {
      console.log('')
      console.log('### Recomendações Pendentes')
      for (const rec of learnings.recommendations) {
        console.log(`- [${rec.priority.toUpperCase()}] ${rec.title}`)
      }
    }

    // Melhores fontes
    if (learnings.patterns?.bestSources?.length > 0) {
      console.log('')
      console.log('### Melhores Fontes (aprendidas)')
      console.log(learnings.patterns.bestSources.join(', '))
    }
  }

  // Próximos passos
  console.log('')
  console.log('## Próximos Passos Sugeridos')

  if (!daemonRunning) {
    console.log('1. ⚠️ Iniciar daemon: `node scripts/auto-daemon.js`')
  }

  const needsMetrics = knowledge?.replies?.filter(r => !r.metrics?.likes).length > 20
  if (needsMetrics) {
    console.log('2. Coletar métricas: `node scripts/collect-metrics.js`')
  }

  const lastAnalysis = learnings?.lastAnalysis ? new Date(learnings.lastAnalysis) : null
  if (!lastAnalysis || (Date.now() - lastAnalysis.getTime()) > 24 * 3600000) {
    console.log('3. Rodar análise: `node scripts/analyze-and-learn.js`')
  }

  console.log('')
}

main()
