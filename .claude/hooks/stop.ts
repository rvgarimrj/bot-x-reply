#!/usr/bin/env tsx
/**
 * Hook executado quando Claude Code termina uma tarefa
 * Toca um som de notificação e mostra alerta visual
 */

import { execSync } from 'child_process';

try {
  // Som de notificação do sistema (macOS)
  execSync('afplay /System/Library/Sounds/Glass.aiff', {
    stdio: 'ignore',
  });

  // Notificação visual do sistema
  const script = `
    display notification "Claude Code terminou a tarefa!" with title "TubeSpark" sound name "Glass"
  `;

  execSync(`osascript -e '${script}'`, {
    stdio: 'ignore',
  });

  console.log('✅ Hook Stop: Notificação enviada com sucesso');
} catch (error) {
  console.error('❌ Hook Stop: Erro ao enviar notificação:', error);
}
