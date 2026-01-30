import puppeteer from 'puppeteer-core'
import { execSync } from 'child_process'

/**
 * Configurações de comportamento humano
 */
const HUMAN_CONFIG = {
  // Velocidade de digitação (ms entre cada caractere)
  typingSpeed: { min: 50, max: 120 },

  // Delays
  delays: {
    pageLoad: { min: 2000, max: 4000 },
    beforeClick: { min: 500, max: 1500 },
    beforeType: { min: 800, max: 1500 },
    afterType: { min: 1000, max: 2000 },
    afterClick: { min: 1500, max: 3000 },
    readTweet: { min: 2000, max: 4000 },
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
 * Fecha aba de forma segura (não fecha se for a última)
 */
async function safeClosePage(browser, page) {
  try {
    const pages = await browser.pages()
    if (pages.length > 1) {
      // Tem mais de uma aba, pode fechar
      console.log(`Fechando aba (${pages.length} abas abertas)`)
      await page.close()
    } else {
      // É a última aba, volta pro home ao invés de fechar
      console.log('Última aba, navegando pro home ao invés de fechar')
      await page.goto('https://x.com/home', { waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {})
    }
  } catch (e) {
    console.log('Erro ao fechar aba:', e.message)
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
 */
async function getBrowser() {
  // Tenta conectar a um Chrome já aberto com debug port
  try {
    const browser = await puppeteer.connect({
      browserURL: 'http://127.0.0.1:9222',
      protocolTimeout: 60000 // 60 segundos de timeout
    })
    console.log('✅ Conectado ao Chrome (porta 9222)')
    return { browser, shouldClose: false }
  } catch (error) {
    // Não conseguiu conectar - precisa abrir Chrome com debug
    throw new Error(
      'Chrome não está rodando com porta de debug.\n\n' +
      'Execute primeiro:\n' +
      './scripts/start-chrome.sh\n\n' +
      'Ou abra o Chrome manualmente com:\n' +
      'open -a "Google Chrome" --args --remote-debugging-port=9222'
    )
  }
}

/**
 * Digita texto com velocidade humana
 */
async function humanType(page, selector, text) {
  await page.waitForSelector(selector, { timeout: 10000 })
  await page.click(selector)
  await humanDelay(HUMAN_CONFIG.delays.beforeType)

  // Digita caractere por caractere
  for (const char of text) {
    await page.keyboard.type(char)
    await new Promise(r => setTimeout(r, randomDelay(HUMAN_CONFIG.typingSpeed)))
  }

  await humanDelay(HUMAN_CONFIG.delays.afterType)
}

/**
 * Clica com comportamento humano
 */
async function humanClick(page, selector) {
  await page.waitForSelector(selector, { timeout: 10000 })
  await humanDelay(HUMAN_CONFIG.delays.beforeClick)

  // Move mouse suavemente até o elemento antes de clicar
  const element = await page.$(selector)
  const box = await element.boundingBox()
  if (box) {
    await page.mouse.move(
      box.x + box.width / 2 + (Math.random() * 10 - 5),
      box.y + box.height / 2 + (Math.random() * 10 - 5),
      { steps: 10 }
    )
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
    await page.setViewport({ width: 1280, height: 800 })

    console.log('Navegando para:', url)
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
    await humanDelay(HUMAN_CONFIG.delays.pageLoad)

    // Scroll para ver o tweet
    await humanScroll(page)
    await humanDelay(HUMAN_CONFIG.delays.readTweet)

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

    // Clica no botão de reply
    console.log('Clicando em reply...')
    await humanClick(page, '[data-testid="reply"]')

    // Aguarda modal de reply abrir
    await humanDelay(HUMAN_CONFIG.delays.afterClick)

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
        console.log('Digitando reply (velocidade humana)...')
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

    // Aguarda o reply ser enviado (modal fecha ou desaparece)
    console.log('Aguardando confirmação do envio...')
    await humanDelay(HUMAN_CONFIG.delays.afterPost)

    // Aguarda mais um pouco para garantir que o modal fechou
    await page.waitForFunction(() => {
      // Verifica se o modal de reply ainda está aberto
      const modal = document.querySelector('[data-testid="tweetButtonInline"]')
      return !modal // Retorna true quando o modal fechou
    }, { timeout: 10000 }).catch(() => {
      console.log('Modal pode ainda estar aberto, continuando...')
    })

    await humanDelay({ min: 1500, max: 2500 })

    // Tira screenshot de confirmação
    const screenshotPath = `/tmp/reply_${Date.now()}.png`
    await page.screenshot({ path: screenshotPath })
    console.log('Screenshot salvo:', screenshotPath)

    // Não fecha a aba se for a única (senão fecha o Chrome)
    const pages = await browser.pages()
    if (pages.length > 1) {
      await safeClosePage(browser, page)
    }
    // Se for única aba, só navega de volta pro home
    else {
      // Handler para dialogs de "descartar alterações"
      page.on('dialog', async dialog => {
        console.log('Dialog detectado:', dialog.message())
        await dialog.dismiss()
      })
      await page.goto('https://x.com/home', { waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {})
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
    await page.goto('https://x.com/home', { waitUntil: 'networkidle2', timeout: 30000 })

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
