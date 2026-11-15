import { _electron as electron, expect } from '@stablyai/playwright-test'
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { checkComposerControls } from './controls.mjs'

if (process.env.ORCA_BACKGROUND_LAUNCH !== '1' || !process.env.RENDERER_EVIDENCE) {
  throw new Error('Requires ORCA_BACKGROUND_LAUNCH=1 and RENDERER_EVIDENCE=<capture directory>')
}
const root = process.cwd()
const output = mkdtempSync(path.join(root, '.bench-fixtures/sidebar-composer-interactions-'))
const main = path.join(output, 'main.cjs')
const report = { checks: [], layouts: [], errors: [] }
await build({
  entryPoints: [path.join(root, 'tests/tools/benchmarks/spinner-rendering/main.ts')],
  outfile: main,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron']
})
const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env
const app = await electron.launch({ args: [main], env })
try {
  const page = await app.firstWindow()
  page.on('pageerror', (error) => report.errors.push(error.message))
  const load = async (state = 'idle') => {
    const url = pathToFileURL(path.resolve(process.env.RENDERER_EVIDENCE, 'renderer/index.html'))
    url.searchParams.set('state', state)
    await page.goto(url.href)
    await page.evaluate(() => document.fonts.ready)
    await page.emulateMedia({ reducedMotion: 'reduce' })
  }
  await load('error')
  const retry = page.getByRole('button', { name: 'Retry', exact: true })
  await retry.focus()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Copy error' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(retry).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(retry).toHaveCount(0)
  await expect(page.getByRole('textbox')).toContainText('Keep the task title clear')
  report.checks.push('Keyboard Retry and Copy error order; draft preserved')

  await load('working')
  await page.getByRole('button', { name: 'Stop the agent' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
  report.checks.push('Keyboard Stop returns to accessible circular Send')
  for (const key of ['Enter', 'Escape']) {
    await load('approval')
    await page.getByRole('button', { name: 'Allow once' }).focus()
    await page.keyboard.press(key)
    await expect(page.getByRole('textbox')).toBeVisible()
  }
  report.checks.push('Approval Enter and Escape return to composer')

  await load()
  for (const name of [/Model Opus 5.5/, /Permission.*Full access/]) {
    const trigger = page.getByRole('button', { name, includeHidden: true })
    await trigger.focus()
    await page.keyboard.press('Enter')
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Escape')
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(trigger).toBeFocused()
    await expect(page.getByRole('textbox')).toContainText('Keep the task title clear')
  }
  report.checks.push('Settings open/close by keyboard, return focus and preserve draft')
  const selection = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-worktree-card-surface]')]
    cards.forEach((card) => {
      card.style.transition = 'none'
    })
    const paint = (card) => getComputedStyle(card).backgroundColor
    const height = cards[0].getBoundingClientRect().height
    const before = cards.map(paint)
    cards[0].removeAttribute('data-worktree-card-active')
    cards[1].setAttribute('data-worktree-card-active', 'primary')
    const after = cards.map(paint)
    const clone = cards[2].cloneNode(true)
    cards[1].append(clone)
    const nestedInactivePaint = paint(clone)
    clone.remove()
    return {
      before,
      after,
      nestedInactivePaint,
      sameHeight: cards[0].getBoundingClientRect().height === height,
      labels: document.querySelectorAll('[data-worktree-card-current-label]').length
    }
  })
  expect(selection.after[1]).toBe(selection.before[0])
  expect(selection.after[0]).toBe(selection.before[1])
  expect(selection.nestedInactivePaint).toBe(selection.before[2])
  expect(selection.sameHeight).toBe(true)
  expect(selection.labels).toBe(0)
  report.checks.push(
    'Eager selection moves the subtle fill without changing row height; nested inactive cards stay inactive'
  )

  const cdp = await page.context().newCDPSession(page)
  await checkComposerControls({ page, cdp, load, report, output })
  for (const coarse of [false, true]) {
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: coarse })
    for (const width of [360, 520, 900]) {
      await app.evaluate(
        ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 900),
        width
      )
      for (const fontSize of [14, 20]) {
        await load('error')
        await page.evaluate((fontSize) => {
          const chat = document.querySelector('.native-chat-appearance')
          chat.style.setProperty('--chat-font-size', `${fontSize}px`)
          chat.style.setProperty('--chat-ui-font-size', `${fontSize}px`)
          const host = document.querySelector('[data-notice-kind="host"] p')
          host.textContent = `Remote host with a long environment name is disconnected. Reconnect before sending. ${'long-host-identifier-'.repeat(5)}`
        }, fontSize)
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        )
        const layout = await page.evaluate(() => {
          const chat = document.querySelector('.native-chat-appearance')
          const composer = document
            .querySelector('[role="textbox"]')
            .closest('.border-chat-composer-border')
          const controls = [...composer.querySelectorAll('button')].map((element) => {
            const target = element.querySelector('span.absolute[aria-hidden]') ?? element
            const rect = target.getBoundingClientRect()
            return {
              name: element.getAttribute('aria-label') || element.textContent,
              left: rect.left,
              right: rect.right,
              top: rect.top,
              bottom: rect.bottom
            }
          })
          const overlaps = controls.flatMap((a, index) =>
            controls
              .slice(index + 1)
              .filter(
                (b) =>
                  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
                  Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
              )
              .map((b) => [a.name, b.name])
          )
          return {
            width: innerWidth,
            height: innerHeight,
            coarse: matchMedia('(pointer: coarse)').matches,
            fontSize: getComputedStyle(chat).getPropertyValue('--text-sm'),
            overflow: document.documentElement.scrollWidth > innerWidth,
            controls,
            overlaps,
            conversationHeight: document.querySelector('section > div.overflow-auto').clientHeight,
            noticesHeight: document.querySelector('[aria-label="Message notices"]').clientHeight
          }
        })
        expect(layout.controls.length).toBeGreaterThanOrEqual(5)
        expect(layout.conversationHeight).toBeGreaterThanOrEqual(layout.height * 0.25)
        expect(layout.noticesHeight).toBeLessThanOrEqual(layout.height * 0.25)
        expect(layout.fontSize).toBe(`${fontSize}px`)
        expect(layout.overflow).toBe(false)
        expect(layout.overlaps).toEqual([])
        for (const control of layout.controls) {
          expect(control.left, control.name).toBeGreaterThanOrEqual(0)
          expect(control.right, control.name).toBeLessThanOrEqual(width)
          expect(control.top, control.name).toBeGreaterThanOrEqual(0)
          expect(control.bottom, control.name).toBeLessThanOrEqual(layout.height)
        }
        report.layouts.push(layout)
        if (fontSize === 20) {
          const notices = page.getByRole('list', { name: 'Message notices' })
          await notices.focus()
          await page.keyboard.press('End')
          await expect
            .poll(() =>
              notices.evaluate(
                (element) => element.scrollHeight - element.clientHeight - element.scrollTop
              )
            )
            .toBeLessThanOrEqual(1)
          await page.getByRole('button', { name: 'Retry', exact: true }).focus()
          await expect
            .poll(() => notices.evaluate((element) => element.scrollTop))
            .toBeLessThanOrEqual(1)
          await page.keyboard.press('Tab')
          await expect(page.getByRole('button', { name: 'Copy error' })).toBeFocused()
          await page.getByRole('textbox').focus()
          await notices.evaluate((element) => {
            element.scrollTop = 0
          })
          const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
          writeFileSync(
            path.join(output, `large-text-${width}-${coarse ? 'touch' : 'mouse'}.png`),
            Buffer.from(data, 'base64')
          )
        }
        console.log(
          `Checked ${width}px, ${fontSize}px text, ${coarse ? 'coarse' : 'fine'} pointer: controls fit without overlaps`
        )
      }
    }
  }
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false })
  report.checks.push(
    'Long notices preserve a quarter-height conversation; keyboard End reveals full host, Retry/Copy remain reachable'
  )
  expect(report.errors).toEqual([])
  report.windows = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((window) => ({
      visible: window.isVisible(),
      focused: window.isFocused()
    }))
  )
  expect(report.windows.every((window) => !window.visible && !window.focused)).toBe(true)
} finally {
  writeFileSync(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Interaction evidence: ${output}`)
  await app.close()
}
