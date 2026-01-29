#!/usr/bin/env tsx
/**
 * Hook executado para notificações gerais do Claude Code
 * Toca um som diferente e mostra alerta visual
 */

import { execSync } from 'child_process';

try {
  // Som de notificação mais suave (macOS)
  execSync('afplay /System/Library/Sounds/Tink.aiff', {
    stdio: 'ignore',
  });

  // Notificação visual do sistema
  const script = `
    display notification "Nova notificação do Claude Code" with title "TubeSpark" sound name "Tink"
  `;

  execSync(`osascript -e '${script}'`, {
    stdio: 'ignore',
  });

  console.log('✅ Hook Notification: Notificação enviada com sucesso');
} catch (error) {
  console.error('❌ Hook Notification: Erro ao enviar notificação:', error);
}
