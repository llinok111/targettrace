// Independent acceptance for the demo page, driven over the DevTools protocol
// (no Playwright dependency). Checks geometry, interaction, console cleanliness
// and pixel statistics, then writes docs/VERIFY-DEMO.json.
//
// Usage: node scripts/verify-demo.cjs [--browser=<path>]
// Requires Node >= 22 (global WebSocket). Skips with exit 0 if no browser found.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { pathToFileURL } = require('node:url')

const png = require('./lib/png-stats.cjs')

const BROWSER_CANDIDATES = [
  process.env.TARGETTRACE_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean)

function findBrowser () {
  const flag = process.argv.find(item => item.startsWith('--browser='))
  if (flag) return flag.slice('--browser='.length)
  return BROWSER_CANDIDATES.find(candidate => fs.existsSync(candidate)) || null
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function waitFor (fn, timeoutMs, label) {
  const started = Date.now()
  let lastError = null
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await fn()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await sleep(120)
  }
  throw new Error(`timeout waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`)
}

class Cdp {
  constructor (url) {
    this.nextId = 1
    this.pending = new Map()
    this.events = []
    this.ws = new WebSocket(url)
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve())
      this.ws.addEventListener('error', event => reject(new Error(`websocket error: ${event.message || 'unknown'}`)))
    })
    this.ws.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`))
        else resolve(message.result)
      } else if (message.method) {
        this.events.push(message)
      }
    })
  }

  send (method, params) {
    const id = this.nextId++
    const payload = JSON.stringify({ id, method, params: params || {} })
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(payload)
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`CDP timeout: ${method}`))
        }
      }, 20000)
    })
  }

  async evaluate (expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    })
    if (result.exceptionDetails) {
      throw new Error(`page error: ${result.exceptionDetails.text} ${result.exceptionDetails.exception && result.exceptionDetails.exception.description}`)
    }
    return result.result.value
  }

  close () {
    try { this.ws.close() } catch (error) { /* ignore */ }
  }
}

async function main () {
  const browser = findBrowser()
  if (!browser) {
    process.stdout.write('no chromium browser found; demo verification skipped\n')
    return
  }
  if (typeof WebSocket === 'undefined') {
    process.stdout.write('global WebSocket missing (needs Node >= 22); demo verification skipped\n')
    return
  }

  const urlFlag = process.argv.find(item => item.startsWith('--url='))
  const liveUrl = urlFlag ? urlFlag.slice('--url='.length) : null

  const demoPath = path.join(__dirname, '..', 'demo', 'index.html')
  if (!liveUrl && !fs.existsSync(demoPath)) {
    throw new Error('demo/index.html missing; run `npm run demo` first')
  }

  const port = 9400 + Math.floor(Math.random() * 200)
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'targettrace-demo-'))
  const url = liveUrl || pathToFileURL(demoPath).href
  const reportFile = liveUrl ? 'VERIFY-DEMO-LIVE.json' : 'VERIFY-DEMO.json'

  const child = spawn(browser, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--window-size=1280,900',
    url
  ], { stdio: 'ignore' })

  const checks = []
  const fail = message => { checks.push({ ok: false, message }); throw new Error(message) }
  const pass = message => { checks.push({ ok: true, message }) }
  const shots = {}
  let cdp = null

  try {
    const target = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      if (!response.ok) return null
      const list = await response.json()
      const pages = list.filter(item => item.type === 'page' && item.webSocketDebuggerUrl)
      if (pages.length === 0) return null
      // Chromium can expose an extra about:blank page next to the requested one;
      // attaching to that would make every DOM probe read an empty document.
      return pages.find(item => item.url === url) ||
        pages.find(item => item.url && item.url !== 'about:blank') ||
        null
    }, 20000, 'devtools target')

    cdp = new Cdp(target.webSocketDebuggerUrl)
    await cdp.ready
    await cdp.send('Runtime.enable')
    await cdp.send('Page.enable')
    await waitFor(() => cdp.evaluate('document.readyState === "complete"'), 15000, 'page load')
    await waitFor(async () => {
      const where = await cdp.evaluate('location.href')
      if (where === url) return true
      await cdp.send('Page.navigate', { url })
      return false
    }, 20000, 'target url')
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280, height: 900, deviceScaleFactor: 1, mobile: false
    })
    await sleep(250)

    const rowCount = await cdp.evaluate('document.querySelectorAll("#ledger tr").length')
    if (rowCount !== 4) fail(`expected 4 ledger rows for the default preset, got ${rowCount}`)
    pass(`default preset renders ${rowCount} ledger rows`)

    const presetCount = await cdp.evaluate('document.querySelectorAll(".preset").length')
    if (presetCount !== 5) fail(`expected 5 presets, got ${presetCount}`)
    pass(`all ${presetCount} presets present`)

    const meta = await cdp.evaluate('document.getElementById("meta").textContent')
    if (!/browserslist \d+\.\d+\.\d+/.test(meta)) fail(`meta line missing versions: ${meta}`)
    if (!/0 replay mismatches/.test(meta)) fail(`meta line missing replay result: ${meta}`)
    pass('meta line reports data versions and replay result')

    const findings = await cdp.evaluate('document.getElementById("findings").textContent.trim()')
    if (findings !== 'no findings') fail(`default preset should be clean, got: ${findings}`)
    pass('default preset shows no findings')

    const chain = await cdp.evaluate('document.getElementById("chain").textContent')
    if (!/in final list/.test(chain)) fail(`provenance panel did not render: ${chain}`)
    pass('provenance panel renders a chain')

    const placeholder = await cdp.evaluate('document.body.innerHTML.includes("__PRESETS__")')
    if (placeholder) fail('template placeholder leaked into the page')
    pass('no template placeholder left behind')

    const desktopOverflow = await cdp.evaluate('({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth })')
    if (desktopOverflow.scroll > desktopOverflow.inner + 1) {
      fail(`desktop horizontal overflow: ${desktopOverflow.scroll} > ${desktopOverflow.inner}`)
    }
    pass(`desktop has no horizontal overflow (${desktopOverflow.scroll} <= ${desktopOverflow.inner})`)

    // Interaction: click the fourth preset and confirm the ledger follows.
    await cdp.evaluate('document.querySelectorAll(".preset")[3].click()')
    await sleep(150)
    const afterClick = await cdp.evaluate(`({
      rows: document.querySelectorAll('#ledger tr').length,
      findings: document.getElementById('findings').textContent,
      pressed: document.querySelectorAll('.preset[aria-pressed=true]').length
    })`)
    if (afterClick.rows !== 3) fail(`clicking preset 4 should render 3 rows, got ${afterClick.rows}`)
    if (!/TT004/.test(afterClick.findings)) fail(`preset 4 should report TT004, got: ${afterClick.findings.slice(0, 80)}`)
    if (afterClick.pressed !== 1) fail('exactly one preset must be pressed')
    pass('preset switching re-renders the ledger and findings')

    const chainLookup = await cdp.evaluate(`(() => {
      var input = document.getElementById('browser')
      input.value = 'ie 11'
      document.getElementById('lookup-btn').click()
      return document.getElementById('chain').textContent
    })()`)
    if (!/ie 11 → (in final list|dropped)/.test(chainLookup)) fail(`explain for ie 11 failed: ${chainLookup.slice(0, 120)}`)
    pass('browser lookup explains ie 11 on the undone-not preset')

    const errors = cdp.events.filter(event =>
      event.method === 'Runtime.exceptionThrown' ||
      (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error')
    )
    if (errors.length > 0) fail(`${errors.length} console/runtime errors on the page`)
    pass('no console or runtime errors')

    // Layout probes: every visible element must have size, must not overflow its
    // own box horizontally, and must stay inside the viewport.
    const layoutProblems = await cdp.evaluate(`(() => {
      const problems = []
      for (const el of document.querySelectorAll('main *')) {
        const style = getComputedStyle(el)
        if (style.display === 'none' || style.visibility === 'hidden') continue
        if (el.tagName === 'DATALIST' || el.tagName === 'OPTION') continue
        const rect = el.getBoundingClientRect()
        const label = (el.id || el.className || el.tagName).toString().slice(0, 40)
        if (rect.width < 1 || rect.height < 1) problems.push('zero-size: ' + label)
        if (el.scrollWidth > el.clientWidth + 2 && style.overflowX === 'visible') {
          problems.push('overflow-x: ' + label + ' ' + el.scrollWidth + '>' + el.clientWidth)
        }
        if (rect.right > window.innerWidth + 1) problems.push('past-viewport: ' + label)
      }
      return problems
    })()`)
    if (layoutProblems.length > 0) fail(`layout problems: ${layoutProblems.slice(0, 6).join(' | ')}`)
    pass('no zero-size, overflowing or off-viewport elements')

    const contrast = await cdp.evaluate(`(() => {
      const toRgb = value => (value.match(/\\d+(\\.\\d+)?/g) || []).slice(0, 3).map(Number)
      const luma = rgb => {
        const parts = rgb.map(channel => {
          const c = channel / 255
          return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
        })
        return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2]
      }
      const backgroundOf = el => {
        let node = el
        while (node) {
          const bg = getComputedStyle(node).backgroundColor
          const rgb = toRgb(bg)
          if (rgb.length === 3 && !/rgba\\(0, 0, 0, 0\\)/.test(bg)) return rgb
          node = node.parentElement
        }
        return [0, 0, 0]
      }
      const selectors = ['#meta', '.tagline', '#ledger th', '#ledger td', '.finding .msg', '.queries .q']
      const out = []
      for (const selector of selectors) {
        const el = document.querySelector(selector)
        if (!el) { out.push({ selector, ratio: null }); continue }
        const fg = luma(toRgb(getComputedStyle(el).color))
        const bg = luma(backgroundOf(el))
        const hi = Math.max(fg, bg)
        const lo = Math.min(fg, bg)
        out.push({ selector, ratio: Number(((hi + 0.05) / (lo + 0.05)).toFixed(2)) })
      }
      return out
    })()`)
    const weak = contrast.filter(entry => entry.ratio !== null && entry.ratio < 4.5)
    if (weak.length > 0) fail(`contrast below WCAG AA: ${weak.map(entry => `${entry.selector} ${entry.ratio}`).join(', ')}`)
    pass(`all sampled text meets WCAG AA (min ${Math.min(...contrast.filter(c => c.ratio !== null).map(c => c.ratio))})`)

    // Desktop screenshot.
    const desktopShot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const desktopBuffer = Buffer.from(desktopShot.data, 'base64')
    fs.mkdirSync(path.join(__dirname, '..', 'shots'), { recursive: true })
    fs.writeFileSync(path.join(__dirname, '..', 'shots', 'demo-desktop.png'), desktopBuffer)
    const desktopImage = png.decode(desktopBuffer)
    const desktopStats = png.stats(desktopImage)
    shots.desktop = desktopStats
    if (desktopStats.width !== 1280) fail(`desktop screenshot width ${desktopStats.width}`)
    if (desktopStats.background.luma > 40) fail(`desktop background is not dark (luma ${desktopStats.background.luma})`)
    if (desktopStats.inkShare < 1 || desktopStats.inkShare > 45) fail(`desktop ink share implausible: ${desktopStats.inkShare}%`)
    if (desktopStats.colors < 30) fail(`desktop screenshot looks flat: ${desktopStats.colors} colors`)
    pass(`desktop screenshot ${desktopStats.width}x${desktopStats.height}, bg luma ${desktopStats.background.luma}, ink ${desktopStats.inkShare}%, ${desktopStats.colors} colors`)

    // Mobile viewport: geometry only.
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 2, mobile: true
    })
    await sleep(250)
    const mobileOverflow = await cdp.evaluate('({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth })')
    if (mobileOverflow.scroll > mobileOverflow.inner + 1) {
      fail(`mobile horizontal overflow: ${mobileOverflow.scroll} > ${mobileOverflow.inner}`)
    }
    pass(`mobile 390px viewport has no horizontal overflow (${mobileOverflow.scroll} <= ${mobileOverflow.inner})`)

    const mobileShot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const mobileBuffer = Buffer.from(mobileShot.data, 'base64')
    fs.writeFileSync(path.join(__dirname, '..', 'shots', 'demo-mobile.png'), mobileBuffer)
    const mobileImage = png.decode(mobileBuffer)
    const mobileStats = png.stats(mobileImage)
    shots.mobile = mobileStats
    if (mobileStats.inkShare < 1) fail(`mobile screenshot looks blank: ${mobileStats.inkShare}% ink`)
    pass(`mobile screenshot ${mobileStats.width}x${mobileStats.height}, ink ${mobileStats.inkShare}%`)

    const report = {
      target: liveUrl || 'demo/index.html',
      browser: path.basename(browser),
      generatedAt: new Date().toISOString(),
      checks,
      shots,
      ok: checks.every(check => check.ok)
    }
    fs.mkdirSync(path.join(__dirname, '..', 'docs'), { recursive: true })
    fs.writeFileSync(
      path.join(__dirname, '..', 'docs', reportFile),
      JSON.stringify(report, null, 2) + '\n',
      'utf8'
    )

    for (const check of checks) process.stdout.write(`${check.ok ? 'PASS' : 'FAIL'} ${check.message}\n`)
    process.stdout.write(`\n${checks.filter(c => c.ok).length}/${checks.length} checks passed\n`)
    if (!report.ok) process.exitCode = 1
  } finally {
    if (cdp) cdp.close()
    child.kill()
    await sleep(300)
    try { fs.rmSync(profile, { recursive: true, force: true }) } catch (error) { /* windows lock */ }
  }
}

main().catch(error => {
  process.stderr.write(`verify-demo failed: ${error.message}\n`)
  process.exitCode = 1
})
