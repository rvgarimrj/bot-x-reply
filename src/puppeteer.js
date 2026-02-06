import puppeteer from 'puppeteer-core'
import { execSync } from 'child_process'

/**
 * Configurações de comportamento humano
 */
const HUMAN_CONFIG = {
  // Velocidade de digitação (ms entre cada caractere)
  // Pessoa normal digita ~40-60 WPM = 200-350ms por char
  typingSpeed: { min: 150, max: 350 },

  // Delays
  delays: {
    pageLoad: { min: 2000, max: 4000 },
    beforeClick: { min: 500, max: 1500 },
    beforeType: { min: 800, max: 1500 },
    afterType: { min: 1000, max: 2000 },
    afterClick: { min: 1500, max: 3000 },
    readTweet: { min: 5000, max: 10000 },  // 5-10s para ler (era 2-4s)
    thinkBeforeReply: { min: 3000, max: 7000 },  // 3-7s pensando antes de responder
    afterPost: { min: 2000, max: 4000 }
  },

  // Scroll
  scroll: {
    amount: { min: 100, max: 300 }
  }
}

/**
 * Gera delay aleatório
 */
function randomDelay(range) {
  return Math.floor(Math.random() * (range.max - range.min + 1)) + range.min
}

/**
 * Aguarda um tempo aleatório
 */
async function humanDelay(range) {
  const ms = randomDelay(range)
  await new Promise(r => setTimeout(r, ms))
}

/**
 * Fecha abas em excesso para liberar memória do Chrome
 * @param {Browser} browser - Browser instance
 * @param {number} maxTabs - Número máximo de abas a manter
 * @param {Page} currentPage - Página atual que NÃO deve ser fechada (opcional)
 */
async function closeExcessTabs(browser, maxTabs = 3, currentPage = null) {
  try {
    const pages = await Promise.race([
      browser.pages(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000))
    ]).catch(() => [])

    // Filtra a página atual se fornecida
    const pagesToClose = pages.filter(p => p !== currentPage)

    if (pagesToClose.length > maxTabs - 1) {
      const numToClose = pagesToClose.length - (maxTabs - 1)
      console.log(`🧹 Fechando ${numToClose} abas em excesso...`)
      // Fecha as abas mais antigas, mantendo as últimas
      for (let i = 0; i < numToClose; i++) {
        await pagesToClose[i].close().catch(() => {})
      }
    }
  } catch (e) {
    // Ignora erros - limpeza não é crítica
  }
}

/**
 * Fecha aba de forma segura (não fecha se for a última)
 * Com timeout curto para não travar o fluxo principal
 */
async function safeClosePage(browser, page) {
  try {
    // Usa Promise.race para não travar se browser.pages() demorar
    const pagesPromise = browser.pages()
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), 10000)
    )

    const pages = await Promise.race([pagesPromise, timeoutPromise]).catch(() => [page])

    if (pages.length > 1) {
      // Tem mais de uma aba, pode fechar
      console.log(`Fechando aba (${pages.length} abas abertas)`)
      await page.close().catch(() => {})
    } else {
      // É a última aba, volta pro home ao invés de fechar
      console.log('Última aba, navegando pro home ao invés de fechar')
      await page.goto('https://x.com/home', { waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {})
    }
  } catch (e) {
    // Ignora erros silenciosamente - fechar aba não é crítico
    console.log('Aviso: não foi possível fechar aba de forma limpa')
  }
}

/**
 * Encontra o caminho do Chrome instalado
 */
function findChromePath() {
  const paths = [
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    // Linux
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    // Windows
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ]

  for (const p of paths) {
    try {
      execSync(`test -f "${p}"`, { stdio: 'ignore' })
      return p
    } catch {}
  }

  // Tenta encontrar via which
  try {
    return execSync('which google-chrome || which chromium', { encoding: 'utf-8' }).trim()
  } catch {}

  return paths[0] // Default para macOS
}

/**
 * Conecta ao Chrome existente (que deve estar logado no X)
 * Com retry automático para lidar com timeouts
 */
async function getBrowser() {
  const maxRetries = 3
  const retryDelay = 5000 // 5 segundos entre tentativas

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const browser = await puppeteer.connect({
        browserURL: 'http://127.0.0.1:9222',
        protocolTimeout: 120000 // 120 segundos de timeout (aumentado de 60s)
      })
      console.log('✅ Conectado ao Chrome (porta 9222)')
      return { browser, shouldClose: false }
    } catch (error) {
      const isTimeout = error.message.includes('timed out') || error.message.includes('timeout')

      if (isTimeout && attempt < maxRetries) {
        console.log(`⏱️ Tentativa ${attempt}/${maxRetries} falhou (timeout), aguardando ${retryDelay/1000}s...`)
        await new Promise(r => setTimeout(r, retryDelay))
        continue
      }

      // Se não é timeout ou é a última tentativa, lança erro apropriado
      if (isTimeout) {
        throw new Error(
          'Chrome está demorando para responder (timeout após 3 tentativas).\n\n' +
          'Possíveis soluções:\n' +
          '1. Feche abas não utilizadas no Chrome\n' +
          '2. Reinicie o Chrome: ./scripts/start-chrome.sh\n' +
          '3. Verifique se há muitas extensões carregadas'
        )
      }

      // Não conseguiu conectar - Chrome não está rodando
      throw new Error(
        'Chrome não está rodando com porta de debug.\n\n' +
        'Execute primeiro:\n' +
        './scripts/start-chrome.sh\n\n' +
        'Ou abra o Chrome manualmente com:\n' +
        'open -a "Google Chrome" --args --remote-debugging-port=9222'
      )
    }
  }
}

/**
 * Insere texto usando page.evaluate + keyboard.type
 * Evita problemas de "JavaScript world" mantendo tudo no mesmo contexto
 */
async function humanType(page, selector, text) {
  // Prioriza textbox dentro de modal/dialog (reply modal do X)
  const modalSelectors = [
    '[role="dialog"] ' + selector,
    '[aria-modal="true"] ' + selector,
    selector
  ]

  // Encontra e clica no elemento usando page.evaluate (evita context issues)
  const foundSelector = await page.evaluate((selectors) => {
    for (const sel of selectors) {
      const el = document.querySelector(sel)
      if (el) {
        el.click()
        el.focus()
        return sel
      }
    }
    return null
  }, modalSelectors)

  if (!foundSelector) {
    console.log('⚠️ Elemento de texto não encontrado')
    throw new Error('Campo de texto não encontrado')
  }

  console.log(`Encontrado elemento: ${foundSelector.slice(0, 50)}`)
  await humanDelay({ min: 400, max: 600 })

  // Usa keyboard.type que não depende de element handles
  const { min, max } = HUMAN_CONFIG.typingSpeed
  const charDelay = min + Math.floor(Math.random() * (max - min))
  console.log(`Digitando ${text.length} chars (delay: ${charDelay}ms/char)...`)

  await page.keyboard.type(text, { delay: charDelay })

  await humanDelay({ min: 300, max: 500 })

  // Verifica se texto foi inserido (tudo via page.evaluate)
  const content = await page.evaluate(() => {
    const selectors = [
      '[role="dialog"] [data-testid="tweetTextarea_0"]',
      '[aria-modal="true"] [data-testid="tweetTextarea_0"]',
      '[data-testid="tweetTextarea_0"]'
    ]
    for (const sel of selectors) {
      const el = document.querySelector(sel)
      if (el && el.textContent?.trim()) {
        return el.textContent.trim()
      }
    }
    return ''
  })

  if (content.length > 0) {
    console.log(`✅ Texto inserido: "${content.slice(0, 30)}..."`)
  } else {
    throw new Error('Texto não foi inserido no campo')
  }
}

/**
 * Calcula tempo de leitura baseado no tamanho do texto
 * Pessoas leem ~200-250 palavras/min = ~100-150ms por caractere
 */
function calculateReadingTime(textLength) {
  // Base: 100-150ms por caractere
  const msPerChar = 100 + Math.floor(Math.random() * 50)
  const baseTime = textLength * msPerChar

  // Mínimo 5 segundos, máximo 20 segundos
  const minTime = 5000
  const maxTime = 20000

  return Math.max(minTime, Math.min(maxTime, baseTime))
}

/**
 * Clica com comportamento humano
 */
async function humanClick(page, selector) {
  await page.waitForSelector(selector, { timeout: 10000 })
  await humanDelay(HUMAN_CONFIG.delays.beforeClick)

  // Move mouse suavemente até o elemento antes de clicar
  const element = await page.$(selector)
  if (element) {
    const box = await element.boundingBox()
    if (box) {
      await page.mouse.move(
        box.x + box.width / 2 + (Math.random() * 10 - 5),
        box.y + box.height / 2 + (Math.random() * 10 - 5),
        { steps: 10 }
      )
    }
  }

  await page.click(selector)
  await humanDelay(HUMAN_CONFIG.delays.afterClick)
}

/**
 * Scroll suave
 */
async function humanScroll(page, amount = null) {
  const scrollAmount = amount || randomDelay(HUMAN_CONFIG.scroll.amount)
  await page.evaluate((y) => {
    window.scrollBy({ top: y, behavior: 'smooth' })
  }, scrollAmount)
  await humanDelay({ min: 500, max: 1000 })
}

/**
 * Extrai dados de um tweet
 */
export async function extractTweet(url) {
  const { browser, shouldClose } = await getBrowser()

  try {
    const page = await browser.newPage()

    // Fecha abas em excesso DEPOIS de criar a nova (protege a atual)
    // maxTabs=6 para não fechar abas de outros processos (R2R, etc)
    await closeExcessTabs(browser, 6, page)

    // Aumenta timeouts para operações na página
    page.setDefaultTimeout(60000)
    page.setDefaultNavigationTimeout(60000)

    // Configura viewport como desktop normal
    await page.setViewport({ width: 1280, height: 800 })

    console.log('Navegando para:', url)
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
    await humanDelay(HUMAN_CONFIG.delays.pageLoad)

    // Scroll para simular leitura
    await humanScroll(page)
    await humanDelay(HUMAN_CONFIG.delays.readTweet)

    // Extrai dados do tweet
    const tweetData = await page.evaluate(() => {
      const getText = (sel) => document.querySelector(sel)?.textContent?.trim() || ''
      const getAttr = (sel, attr) => document.querySelector(sel)?.getAttribute(attr) || ''

      // Tenta diferentes seletores (X muda frequentemente)
      const tweetTextSelectors = [
        '[data-testid="tweetText"]',
        'article [lang]',
        'article div[dir="auto"]'
      ]

      let text = ''
      for (const sel of tweetTextSelectors) {
        const el = document.querySelector(sel)
        if (el) {
          text = el.textContent?.trim()
          if (text) break
        }
      }

      // Autor
      const authorLink = document.querySelector('article a[href*="/status/"]')?.href || ''
      const authorMatch = authorLink.match(/x\.com\/(\w+)\/status/)
      const author = authorMatch ? authorMatch[1] : ''

      // Métricas
      const getMetric = (testId) => {
        const el = document.querySelector(`[data-testid="${testId}"]`)
        const text = el?.textContent || '0'
        const num = parseInt(text.replace(/[^\d]/g, '')) || 0
        return num
      }

      return {
        text,
        author,
        likes: getMetric('like'),
        replies: getMetric('reply'),
        retweets: getMetric('retweet')
      }
    })

    await safeClosePage(browser, page)

    return {
      success: true,
      ...tweetData,
      url
    }

  } catch (error) {
    console.error('Erro ao extrair tweet:', error.message)
    return { success: false, error: error.message }
  } finally {
    if (shouldClose) {
      await browser.close()
    }
  }
}

/**
 * Posta um reply em um tweet
 */
export async function postReply(url, replyText) {
  const { browser, shouldClose } = await getBrowser()

  try {
    const page = await browser.newPage()

    // Handler para dialogs (aceita beforeunload automaticamente)
    page.on('dialog', async dialog => {
      console.log('Dialog detectado:', dialog.type(), dialog.message())
      await dialog.accept()
    })

    // Aumenta timeouts para operações na página
    page.setDefaultTimeout(60000) // 60s para operações gerais
    page.setDefaultNavigationTimeout(60000) // 60s para navegação

    await page.setViewport({ width: 1280, height: 800 })

    // Fecha TODAS as outras abas antes de postar (evita reply ir pra aba errada)
    await closeExcessTabs(browser, 2, page)

    console.log('Navegando para:', url)
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
    await humanDelay(HUMAN_CONFIG.delays.pageLoad)

    // Extrai tweet ID da URL alvo
    const targetTweetId = url.split('/status/')[1]?.split(/[?#]/)[0]

    // VERIFICAÇÃO: Confirma que estamos na página certa
    const currentUrl = page.url()
    if (targetTweetId && !currentUrl.includes(targetTweetId)) {
      console.log(`❌ URL errada! Esperava tweet ${targetTweetId}, estou em: ${currentUrl}`)
      await safeClosePage(browser, page)
      return { success: false, error: 'wrong_page' }
    }

    // Verifica se replies estão restritos ("Quem pode responder?" / "Who can reply?")
    const isRestricted = await page.evaluate(() => {
      const pageText = document.body.innerText || ''
      // Detecta mensagens de restrição em PT e EN
      const restrictedPatterns = [
        'quem pode responder',
        'who can reply',
        'pessoas mencionadas podem responder',
        'mentioned people can reply',
        'contas que você segue podem responder',
        'accounts you follow can reply',
        'apenas pessoas mencionadas',
        'only people mentioned'
      ]
      const lowerText = pageText.toLowerCase()
      return restrictedPatterns.some(pattern => lowerText.includes(pattern))
    })

    if (isRestricted) {
      console.log('⛔ Tweet com replies restritos - pulando')
      await safeClosePage(browser, page)
      return { success: false, error: 'replies_restricted', skippable: true }
    }

    // Verifica se autor bloqueou a conta
    const isBlocked = await page.evaluate(() => {
      const pageText = document.body.innerText || ''
      const blockedPatterns = [
        'este autor te bloqueou',
        'this author has blocked you',
        'autor te bloqueou',
        'author blocked you',
        'você foi bloqueado',
        'you have been blocked',
        'não pode fazer essa ação',
        'cannot perform this action'
      ]
      const lowerText = pageText.toLowerCase()
      return blockedPatterns.some(pattern => lowerText.includes(pattern))
    })

    if (isBlocked) {
      console.log('🚫 Autor bloqueou a conta - pulando')
      // Tenta fechar modal se existir
      await page.evaluate(() => {
        const btn = document.querySelector('button')
        if (btn && (btn.textContent?.includes('Entendi') || btn.textContent?.includes('OK'))) {
          btn.click()
        }
      }).catch(() => {})
      await safeClosePage(browser, page)
      return { success: false, error: 'author_blocked', skippable: true }
    }

    // Scroll para ver o tweet
    await humanScroll(page)

    // Extrai texto do tweet para calcular tempo de leitura
    const tweetText = await page.evaluate(() => {
      const tweetElement = document.querySelector('[data-testid="tweetText"]')
      return tweetElement ? tweetElement.innerText : ''
    })

    // Calcula tempo de leitura baseado no tamanho do tweet
    const readingTime = calculateReadingTime(tweetText.length)
    console.log(`📖 Lendo tweet (${tweetText.length} chars, ${Math.round(readingTime/1000)}s)...`)
    await humanDelay({ min: readingTime, max: readingTime + 2000 })

    // Pausa para "pensar" antes de responder
    console.log('🤔 Pensando na resposta...')
    await humanDelay(HUMAN_CONFIG.delays.thinkBeforeReply)

    // Verifica se já tem like antes de dar like
    try {
      // Se existe botão "unlike", significa que JÁ TEM like (não clicar!)
      const alreadyLiked = await page.$('[data-testid="unlike"]')
      if (alreadyLiked) {
        console.log('👍 Já tem like, não vou clicar')
      } else {
        // Não tem like ainda, pode dar like
        const likeButton = await page.$('[data-testid="like"]')
        if (likeButton) {
          console.log('❤️ Dando like...')
          await humanClick(page, '[data-testid="like"]')
        }
      }
    } catch (e) {
      console.log('Like: não consegui verificar, pulando')
    }

    // Verifica se tweet tem replies restritos ANTES de tentar
    const replyButton = await page.$('[data-testid="reply"]')
    if (!replyButton) {
      throw new Error('Tweet com replies restritos (botão não encontrado)')
    }

    // Verifica se o botão está desabilitado ou tem indicação de restrição
    const isReplyRestricted = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="reply"]')
      if (!btn) return true
      // Verifica se está desabilitado
      if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') return true
      // Verifica se tem texto de restrição na página
      const restrictedTexts = ['who can reply', 'quem pode responder', 'can\'t reply', 'não pode responder']
      const pageText = document.body.innerText.toLowerCase()
      return restrictedTexts.some(t => pageText.includes(t))
    })

    if (isReplyRestricted) {
      throw new Error('Tweet com replies restritos (verificado via DOM)')
    }

    // MÉTODO: Clica no botão de reply do tweet ESPECÍFICO (focado na URL)
    console.log('Abrindo área de reply...')

    // Encontra o tweet principal/focado e clica no SEU botão de reply
    // (não no primeiro reply button da página que pode ser de outro tweet)
    const replyButtonClicked = await page.evaluate(() => {
      // Procura tweets na página
      const tweets = document.querySelectorAll('article[data-testid="tweet"]')

      // O tweet focado geralmente é o que tem a área de reply inline visível
      // ou é o último tweet principal antes da seção de replies
      for (const tweet of tweets) {
        // Verifica se este tweet tem a área de reply inline (indica que é o focado)
        const hasInlineReply = tweet.querySelector('[data-testid="tweetTextarea_0"]')
          || tweet.parentElement?.querySelector('[placeholder*="resposta"]')
          || tweet.parentElement?.querySelector('[placeholder*="reply"]')

        if (hasInlineReply) {
          // Encontrou o tweet com área de reply - clica no botão de reply dele
          const replyBtn = tweet.querySelector('[data-testid="reply"]')
          if (replyBtn) {
            replyBtn.click()
            return true
          }
        }
      }

      // Fallback: se não achou área inline, pega o ÚLTIMO tweet (que é o focado no URL)
      const lastTweet = tweets[tweets.length - 1]
      if (lastTweet) {
        const replyBtn = lastTweet.querySelector('[data-testid="reply"]')
        if (replyBtn) {
          replyBtn.click()
          return true
        }
      }

      // Último fallback: primeiro botão de reply
      const firstBtn = document.querySelector('[data-testid="reply"]')
      if (firstBtn) {
        firstBtn.click()
        return true
      }

      return false
    })

    // Aguarda um pouco e verifica se apareceu modal de erro (bloqueado, etc)
    await humanDelay({ min: 1000, max: 1500 })

    const errorModal = await page.evaluate(() => {
      const modalText = document.body.innerText?.toLowerCase() || ''
      const errorPatterns = [
        'autor te bloqueou',
        'author blocked',
        'não pode fazer essa ação',
        'cannot perform this action',
        'algo deu errado',
        'something went wrong'
      ]

      if (errorPatterns.some(p => modalText.includes(p))) {
        // Tenta fechar o modal
        const buttons = document.querySelectorAll('button, [role="button"]')
        for (const btn of buttons) {
          const text = btn.textContent?.toLowerCase() || ''
          if (text.includes('entendi') || text.includes('ok') || text.includes('fechar')) {
            btn.click()
            return 'blocked'
          }
        }
        return 'error'
      }
      return null
    })

    if (errorModal) {
      console.log('🚫 Modal de erro detectado - autor pode ter bloqueado')
      await safeClosePage(browser, page)
      return { success: false, error: 'author_blocked', skippable: true }
    }

    // Aguarda modal ou área inline aparecer
    await humanDelay(HUMAN_CONFIG.delays.afterClick)

    // Verifica se o campo de texto está disponível
    let textboxReady = await page.waitForSelector('[data-testid="tweetTextarea_0"], [contenteditable="true"][role="textbox"]', { timeout: 8000 }).catch(() => null)

    // Se não encontrou, tenta clicar na área inline diretamente
    if (!textboxReady) {
      console.log('Tentando área inline diretamente...')
      await page.evaluate(() => {
        const replyArea = document.querySelector('[data-testid="tweetTextarea_0"]')
          || document.querySelector('[placeholder*="resposta"]')
          || document.querySelector('[placeholder*="reply"]')
          || document.querySelector('[contenteditable="true"][role="textbox"]')
        if (replyArea) {
          replyArea.click()
          replyArea.focus()
        }
      })
      await humanDelay({ min: 500, max: 1000 })
      textboxReady = await page.waitForSelector('[data-testid="tweetTextarea_0"], [contenteditable="true"][role="textbox"]', { timeout: 5000 }).catch(() => null)
    }

    if (!textboxReady) {
      throw new Error('Campo de reply não ficou disponível')
    }

    // Aguarda estabilizar
    await humanDelay({ min: 500, max: 800 })

    // Encontra o campo de texto
    const replySelectors = [
      '[data-testid="tweetTextarea_0"]',
      '[contenteditable="true"][role="textbox"]'
    ]

    // VERIFICAÇÃO PRÉ-DIGITAÇÃO: Ainda estamos na página certa?
    const preTypeUrl = page.url()
    if (targetTweetId && !preTypeUrl.includes(targetTweetId)) {
      console.log(`❌ Página mudou antes de digitar! Estou em: ${preTypeUrl}`)
      await safeClosePage(browser, page)
      return { success: false, error: 'page_changed' }
    }

    let typed = false
    let lastError = null
    for (const sel of replySelectors) {
      try {
        const element = await page.waitForSelector(sel, { timeout: 5000 }).catch(() => null)
        if (!element) continue  // Seletor não encontrado, tenta próximo

        console.log('Inserindo reply (via DOM, nao interfere com teclado)...')
        await humanType(page, sel, replyText)
        typed = true
        break
      } catch (e) {
        // Erro do humanType - guarda e continua tentando outros seletores
        lastError = e
        console.log(`⚠️ Falha com seletor ${sel}: ${e.message}`)
      }
    }

    if (!typed) {
      throw lastError || new Error('Não encontrei o campo de reply')
    }

    // Clica no botão de postar/responder
    console.log('Procurando botão de postar...')

    // Primeiro tenta os seletores padrão
    const postSelectors = [
      '[data-testid="tweetButtonInline"]',
      '[data-testid="tweetButton"]'
    ]

    let posted = false
    for (const sel of postSelectors) {
      try {
        const btn = await page.$(sel)
        if (btn) {
          // Verifica se o botão está habilitado (não está disabled)
          const isDisabled = await page.evaluate(el => el.disabled || el.getAttribute('aria-disabled') === 'true', btn)
          if (!isDisabled) {
            console.log(`Encontrado botão habilitado: ${sel}`)
            await humanClick(page, sel)
            posted = true
            console.log('Botão clicado!')
            break
          } else {
            console.log(`Botão ${sel} encontrado mas desabilitado`)
          }
        }
      } catch (e) {
        console.log(`Botão ${sel} não encontrado: ${e.message}`)
      }
    }

    // Se não encontrou pelos seletores, tenta encontrar pelo texto
    if (!posted) {
      console.log('Tentando encontrar botão pelo texto...')
      try {
        // Procura botão com texto "Reply", "Responder", "Post" ou similar
        const btnByText = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button, [role="button"]'))
          for (const btn of buttons) {
            const text = btn.textContent?.toLowerCase() || ''
            const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || ''
            if (text.includes('reply') || text.includes('responder') ||
                text.includes('post') || text.includes('postar') ||
                ariaLabel.includes('reply') || ariaLabel.includes('post')) {
              // Verifica se está visível e não desabilitado
              const style = window.getComputedStyle(btn)
              if (style.display !== 'none' && style.visibility !== 'hidden' && !btn.disabled) {
                return true
              }
            }
          }
          return false
        })

        if (btnByText) {
          // Clica no botão encontrado
          await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button, [role="button"]'))
            for (const btn of buttons) {
              const text = btn.textContent?.toLowerCase() || ''
              const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || ''
              if (text.includes('reply') || text.includes('responder') ||
                  text.includes('post') || text.includes('postar') ||
                  ariaLabel.includes('reply') || ariaLabel.includes('post')) {
                const style = window.getComputedStyle(btn)
                if (style.display !== 'none' && style.visibility !== 'hidden' && !btn.disabled) {
                  btn.click()
                  return
                }
              }
            }
          })
          posted = true
          console.log('Botão encontrado por texto e clicado!')
        }
      } catch (e) {
        console.log('Erro ao buscar botão por texto:', e.message)
      }
    }

    if (!posted) {
      // Última tentativa: screenshot para debug
      await page.screenshot({ path: '/tmp/debug_no_button.png' })
      console.error('ERRO: Nenhum botão de post encontrado! Screenshot salvo em /tmp/debug_no_button.png')
      throw new Error('Não encontrei o botão de postar reply')
    }

    // Aguarda o reply ser enviado
    console.log('Aguardando confirmação do envio...')

    // Espera modal fechar primeiro
    const modalClosed = await page.waitForFunction(() => {
      const modal = document.querySelector('[role="dialog"]')
      return !modal
    }, { timeout: 10000 }).catch(() => null)

    if (modalClosed) {
      console.log('Modal fechou, verificando se reply foi postado...')
    }

    // Aguarda o X processar
    await humanDelay({ min: 4000, max: 6000 })

    // VERIFICAÇÃO OBRIGATÓRIA: Recarrega e busca nosso reply na thread
    let replyConfirmed = false
    const replyStart = replyText.slice(0, 20).toLowerCase()

    try {
      // Recarrega a página para ver o reply
      console.log('Recarregando página para verificar...')
      await page.reload({ waitUntil: 'networkidle2', timeout: 15000 })
      await humanDelay({ min: 2000, max: 3000 })

      // Busca nosso reply na thread
      replyConfirmed = await page.evaluate((searchText, myUsername) => {
        const articles = document.querySelectorAll('article[data-testid="tweet"]')
        for (const article of articles) {
          const text = article.innerText?.toLowerCase() || ''
          // Verifica se tem nosso username E o início do texto do reply
          if (text.includes(myUsername.toLowerCase()) && text.includes(searchText)) {
            return true
          }
        }
        return false
      }, replyStart, 'gabrielabiramia')

      if (replyConfirmed) {
        console.log('✅ Reply confirmado na thread!')
      } else {
        console.log('⚠️ Reply NÃO encontrado na thread!')
      }
    } catch (e) {
      console.log('Erro ao verificar reply:', e.message)
      replyConfirmed = false
    }

    await humanDelay({ min: 1500, max: 2500 })

    // Tira screenshot de confirmação
    const screenshotPath = `/tmp/reply_${Date.now()}.png`
    await page.screenshot({ path: screenshotPath })
    console.log('Screenshot salvo:', screenshotPath)

    // Fecha aba
    await safeClosePage(browser, page)

    if (!replyConfirmed) {
      console.log('⚠️ Reply pode não ter sido postado')
      return {
        success: false,
        screenshot: screenshotPath,
        error: 'Reply não confirmado'
      }
    }

    return {
      success: true,
      screenshot: screenshotPath,
      message: 'Reply postado com sucesso!'
    }

  } catch (error) {
    console.error('Erro ao postar reply:', error.message)
    return { success: false, error: error.message }
  } finally {
    if (shouldClose) {
      await browser.close()
    }
  }
}

/**
 * Verifica se está logado no X
 */
export async function checkLogin() {
  const { browser, shouldClose } = await getBrowser()

  try {
    const page = await browser.newPage()
    page.setDefaultTimeout(60000)
    page.setDefaultNavigationTimeout(60000)

    await closeExcessTabs(browser, 6, page)

    await page.goto('https://x.com/home', { waitUntil: 'networkidle2', timeout: 60000 })

    // Verifica se tem o botão de postar (indica que está logado)
    const isLoggedIn = await page.evaluate(() => {
      return !!document.querySelector('[data-testid="SideNav_NewTweet_Button"]')
    })

    await safeClosePage(browser, page)
    return isLoggedIn

  } catch (error) {
    return false
  } finally {
    if (shouldClose) {
      await browser.close()
    }
  }
}

export default { extractTweet, postReply, checkLogin }
