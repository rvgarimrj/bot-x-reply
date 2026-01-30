#!/bin/bash

# Desativa App Nap para o Chrome (necessário para funcionar com tela bloqueada)
defaults write com.google.Chrome NSAppSleepDisabled -bool YES

echo "✅ App Nap desativado para Chrome"
