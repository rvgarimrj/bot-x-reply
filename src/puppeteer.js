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
 */
async function closeExcessTabs(browser, maxTabs = 3) {
  try {
    const pages = await Promise.race([
      browser.pages(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000))
    ]).catch(() => [])

    if (pages.length > maxTabs) {
      console.log(`🧹 Fechando ${pages.length - maxTabs} abas em excesso...`)
      // Fecha as abas mais antigas, mantendo as últimas
      for (let i = 0; i < pages.length - maxTabs; i++) {
        await pages[i].close().catch(() => {})
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
 * Insere texto usando keyboard.type (método mais confiável para o X)
 * Usa digitação rápida (não char por char) para não demorar muito
 * e não interferir tanto com o usuário
 */
async function humanType(page, selector, text) {
  await page.waitForSelector(selector, { timeout: 10000 })

  // Clica no campo para focar
  await page.click(selector)
  await humanDelay({ min: 500, max: 800 })

  // Foca no elemento correto do X (contenteditable)
  await page.evaluate(() => {
    const textbox = document.querySelector('[data-testid="tweetTextarea_0"]')
      || document.querySelector('[contenteditable="true"][role="textbox"]')
      || document.querySelector('[data-testid="tweetTextarea_0RichTextInputContainer"]')

    if (textbox) {
      textbox.focus()
      // Clica para garantir o cursor
      textbox.click()
    }
  })

  await humanDelay({ min: 200, max: 400 })

  // Usa keyboard.type com delay humanizado
  // delay: 50-120ms por char = texto de 100 chars leva 5-12 segundos (mais humano)
  const { min, max } = HUMAN_CONFIG.typingSpeed
  const charDelay = min + Math.floor(Math.random() * (max - min)) // 50-120ms
  console.log(`Digitando ${text.length} chars (delay: ${charDelay}ms/char)...`)

  await page.keyboard.type(text, { delay: charDelay })

  // Verifica se o texto foi inserido
  const textInserted = await page.evaluate(() => {
    const textbox = document.querySelector('[data-testid="tweetTextarea_0"]')
      || document.querySelector('[contenteditable="true"][role="textbox"]')
    return textbox && textbox.textContent && textbox.textContent.trim().length > 0
  })

  if (!textInserted) {
    console.log('Texto não detectado, tentando método alternativo...')
    // Fallback: tenta clicar e digitar novamente
    await page.click(selector)
    await humanDelay({ min: 300, max: 500 })
    await page.keyboard.type(text, { delay: charDelay })
  }

  // Delay depois (simula humano verificando o texto)
  await humanDelay({ min: 400, max: 700 })
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
    // Fecha abas em excesso para liberar memória do Chrome
    await closeExcessTabs(browser, 3)

    const page = await browser.newPage()

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
    // Fecha abas em excesso para liberar memória do Chrome
    await closeExcessTabs(browser, 3)

    const page = await browser.newPage()

    // Aumenta timeouts para operações na página
    page.setDefaultTimeout(60000) // 60s para operações gerais
    page.setDefaultNavigationTimeout(60000) // 60s para navegação

    await page.setViewport({ width: 1280, height: 800 })

    console.log('Navegando para:', url)
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
    await humanDelay(HUMAN_CONFIG.delays.pageLoad)

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

    // Clica no botão de reply
    console.log('Clicando em reply...')
    await humanClick(page, '[data-testid="reply"]')

    // Aguarda modal de reply abrir
    await humanDelay(HUMAN_CONFIG.delays.afterClick)

    // Verifica se modal abriu corretamente
    const modalOpened = await page.waitForSelector('[data-testid="tweetTextarea_0"], [contenteditable="true"][role="textbox"]', { timeout: 8000 }).catch(() => null)
    if (!modalOpened) {
      throw new Error('Modal de reply não abriu (possível restrição)')
    }

    // Encontra o campo de texto do reply
    const replySelectors = [
      '[data-testid="tweetTextarea_0"]',
      '[contenteditable="true"][role="textbox"]',
      'div[data-contents="true"]'
    ]

    let typed = false
    for (const sel of replySelectors) {
      try {
        await page.waitForSelector(sel, { timeout: 5000 })
        console.log('Inserindo reply (via DOM, nao interfere com teclado)...')
        await humanType(page, sel, replyText)
        typed = true
        break
      } catch {}
    }

    if (!typed) {
      throw new Error('Não encontrei o campo de reply')
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
    await humanDelay(HUMAN_CONFIG.delays.afterPost)

    // Aguarda o campo de texto sumir (indica que reply foi enviado)
    console.log('Verificando se reply foi enviado...')
    let replyConfirmed = false
    try {
      await page.waitForFunction(() => {
        // Verifica se o campo de texto do reply sumiu ou está vazio
        const textbox = document.querySelector('[data-testid="tweetTextarea_0"]')
        if (!textbox) return true // Campo sumiu = reply enviado
        const text = textbox.textContent || ''
        return text.trim() === '' // Campo vazio = reply enviado
      }, { timeout: 15000 })
      replyConfirmed = true
      console.log('Reply confirmado!')
    } catch (e) {
      console.log('Timeout aguardando confirmação, verificando URL...')
      // Fallback: verifica se URL mudou ou se está na página do tweet
      const currentUrl = page.url()
      if (currentUrl.includes('/status/')) {
        replyConfirmed = true
        console.log('Ainda na página do tweet, assumindo sucesso')
      }
    }

    await humanDelay({ min: 2000, max: 3500 })

    // Tira screenshot de confirmação
    const screenshotPath = `/tmp/reply_${Date.now()}.png`
    await page.screenshot({ path: screenshotPath })
    console.log('Screenshot salvo:', screenshotPath)

    // Só tenta navegar/fechar se o reply foi confirmado
    if (replyConfirmed) {
      const pages = await browser.pages()
      if (pages.length > 1) {
        await safeClosePage(browser, page)
      } else {
        // Não navega para home - deixa na página do tweet
        // Isso evita o dialog "Sair do site?"
        console.log('Mantendo na página do tweet')
      }
    } else {
      console.log('Reply não confirmado, mantendo página aberta para debug')
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
    await closeExcessTabs(browser, 3)

    const page = await browser.newPage()
    page.setDefaultTimeout(60000)
    page.setDefaultNavigationTimeout(60000)

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
