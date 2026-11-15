import { expect } from '@stablyai/playwright-test'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export function permissionPreviewHarness({ app, page, cdp, output, report }) {
  const trigger = () => page.getByRole('button', { name: /^Permissions /, includeHidden: true })
  const load = async (
    variant,
    width = 1440,
    fontSize = 14,
    coarse = false,
    disabled = false,
    context = 'remote',
    state = 'idle',
    model = 'claude'
  ) => {
    await app.evaluate(
      ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 900),
      width
    )
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: coarse })
    const url = pathToFileURL(path.join(output, 'renderer/index.html'))
    url.searchParams.set('permissionPreview', variant)
    url.searchParams.set('permissionContext', context)
    url.searchParams.set('state', state)
    url.searchParams.set('model', model)
    if (disabled) {
      url.searchParams.set('permissionDisabled', '1')
    }
    await page.goto(url.href)
    await expect(page.getByRole('textbox')).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.evaluate((size) => {
      const chat = document.querySelector('.native-chat-appearance')
      chat.style.setProperty('--chat-font-size', `${size}px`)
      chat.style.setProperty('--chat-ui-font-size', `${size}px`)
    }, fontSize)
    await page.mouse.move(0, 0)
    await page.waitForTimeout(250)
  }
  const capture = async (name, menu = false, full = false) => {
    await page.waitForTimeout(250)
    const clip = full
      ? undefined
      : await page.evaluate((menu) => {
          const composer = document
            .querySelector('[role="textbox"]')
            .closest('.border-chat-composer-border')
            .getBoundingClientRect()
          const footer = document
            .querySelector('[data-permission-context-row]')
            ?.getBoundingClientRect()
          const popup = menu
            ? document.querySelector('[data-slot="dropdown-menu-content"]').getBoundingClientRect()
            : composer
          const x = Math.max(0, Math.min(composer.x, popup.x) - 8)
          const y = Math.max(0, Math.min(composer.y, popup.y) - 8)
          return {
            x,
            y,
            width: Math.min(innerWidth - x, Math.max(composer.right, popup.right) - x + 8),
            height: Math.min(innerHeight - y, (footer?.bottom ?? composer.bottom) - y + 8),
            scale: 1
          }
        }, menu)
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      ...(clip ? { clip } : {})
    })
    writeFileSync(path.join(output, `${name}.png`), Buffer.from(data, 'base64'))
    report.captures.push(name)
  }
  return { trigger, load, capture }
}

export async function checkPermissionPreviews({ app, page, cdp, output, report }) {
  report.scope =
    'Preview-only permission controls inside the production composer; no agent or permission changes.'
  report.layouts = []
  report.checks = []
  const { trigger, load, capture } = permissionPreviewHarness({ app, page, cdp, output, report })
  for (const variant of ['current', 'text', 'dot', 'shield']) {
    await load(variant)
    await capture(`${variant}-closed`)
    await capture(`${variant}-full-view`, false, true)
    const draft = await page.getByRole('textbox').textContent()
    await trigger().focus()
    await page.keyboard.press('Enter')
    await expect(trigger()).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('menuitemradio')).toHaveCount(4)
    await expect(
      page.getByRole('menuitemradio', { name: /Never asks before edits or commands/ })
    ).toHaveAttribute('aria-checked', 'true')
    await capture(`${variant}-open`, true)
    await page.keyboard.press('Escape')
    await expect(trigger()).toBeFocused()
    await expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    await capture(`${variant}-focus`)
    await page.getByRole('textbox').focus()
    await trigger().hover()
    await capture(`${variant}-hover`)
    await trigger().click()
    await page.getByRole('menuitemradio', { name: /^Ask for approval/ }).click()
    await expect(trigger()).toHaveAttribute('aria-label', 'Permissions Ask for approval')
    await trigger().click()
    await expect(page.getByRole('menuitemradio', { name: /^Ask for approval/ })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    await page.keyboard.press('Escape')
    await page.getByRole('textbox').focus()
    await page.mouse.move(0, 0)
    await capture(`${variant}-ask`)
    for (const label of [
      'Accept edits',
      'Approve for me',
      variant === 'dot' ? 'No approvals' : 'Full access'
    ]) {
      await trigger().focus()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('menu')).toBeVisible()
      await page.keyboard.press('Home')
      await expect(page.getByRole('menuitemradio').first()).toBeFocused()
      // Exercise the Radix keyboard selection path, not a programmatic state write.
      const index =
        [
          'Accept edits',
          'Approve for me',
          variant === 'dot' ? 'No approvals' : 'Full access'
        ].indexOf(label) + 1
      for (let i = 0; i < index; i++) {
        await page.keyboard.press('ArrowDown')
        await expect(page.getByRole('menuitemradio').nth(i + 1)).toBeFocused()
      }
      await page.keyboard.press('Enter')
      await expect(trigger()).toHaveAttribute('aria-label', `Permissions ${label}`)
    }
    await expect(page.getByRole('textbox')).toHaveText(draft)
    await load(variant, 1440, 14, false, true)
    await expect(trigger()).toBeDisabled()
    await capture(`${variant}-disabled`)
    report.checks.push(
      `${variant}: mouse and keyboard select every mode, selected radio state, Escape/focus return, unchanged draft, disabled trigger`
    )

    for (const width of [360, 520, 900]) {
      for (const fontSize of [14, 20]) {
        for (const coarse of [false, true]) {
          await load(variant, width, fontSize, coarse)
          const geometry = await page.evaluate(() => {
            const composer = document
              .querySelector('[role="textbox"]')
              .closest('.border-chat-composer-border')
            const buttons = [...composer.querySelectorAll('button')].filter(
              (b) => b.getBoundingClientRect().width > 0
            )
            const box = (el) => {
              const { x, y, width, height } = el.getBoundingClientRect()
              return { x, y, width, height }
            }
            return {
              overflow: document.documentElement.scrollWidth > innerWidth,
              buttons: buttons.map((b) => ({ label: b.getAttribute('aria-label'), ...box(b) }))
            }
          })
          expect(geometry.overflow).toBe(false)
          // Model and effort share one button in the production picker.
          expect(geometry.buttons.map((button) => button.label)).toEqual([
            'Attach file',
            variant === 'dot' ? 'Permissions No approvals' : 'Permissions Full access',
            expect.stringMatching(/^Model Opus 5.5/),
            'Start dictation',
            'Send'
          ])
          for (const [i, a] of geometry.buttons.entries()) {
            expect(a.x).toBeGreaterThanOrEqual(0)
            expect(a.x + a.width).toBeLessThanOrEqual(width + 1)
            for (const b of geometry.buttons.slice(i + 1)) {
              expect(
                Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1 &&
                  Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1
              ).toBe(false)
            }
          }
          const permission = await trigger().boundingBox()
          expect(permission.height).toBeCloseTo(((coarse ? 44 : 32) * fontSize) / 14, 1)
          await trigger().click()
          const menu = await page.getByRole('menu').boundingBox()
          expect(menu.x).toBeGreaterThanOrEqual(0)
          expect(menu.x + menu.width).toBeLessThanOrEqual(width + 1)
          expect(menu.y).toBeGreaterThanOrEqual(0)
          expect(menu.y + menu.height).toBeLessThanOrEqual(901)
          if (fontSize === 14 && !coarse && width !== 900) {
            await capture(`${variant}-${width}-open`, true)
          }
          await page.keyboard.press('Escape')
          report.layouts.push({ variant, width, fontSize, coarse, geometry, menu })
        }
      }
    }
    console.log(
      `Checked ${variant}: 12 layouts, four modes, keyboard, disabled and full menu captures`
    )
  }
}
