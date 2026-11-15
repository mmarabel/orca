import { expect } from '@stablyai/playwright-test'
import { permissionPreviewHarness } from './permission-previews.mjs'

const variants = ['current', 'footer-sliders', 'footer-lock', 'footer-shield']
const labels = ['Ask for approval', 'Accept edits', 'Approve for me', 'Full access']

export async function checkFooterPreviews(args) {
  const { page, report } = args
  const { trigger, load, capture } = permissionPreviewHarness(args)
  report.scope =
    'Fixture-only footer with modeled newer-app metadata; actual composer/pickers. Local React permissions only, no host changes or agent turns.'
  report.layouts = []
  report.checks = []
  for (const variant of variants) {
    const footer = variant !== 'current'
    const accessible = (label) =>
      `${footer ? 'Permissions for this chat:' : 'Permissions'} ${label}`
    await load(variant)
    await capture(`${variant}-closed`)
    await capture(`${variant}-full-view`, false, true)
    const draft = await page.getByRole('textbox').textContent()
    // The footer must follow Send in real keyboard order, not merely look moved.
    await page.getByRole('textbox').focus()
    const order = footer
      ? ['Attach file', /^Model /, 'Start dictation', 'Send', accessible('Full access')]
      : ['Attach file', accessible('Full access'), /^Model /, 'Start dictation', 'Send']
    for (const name of order) {
      await page.keyboard.press('Tab')
      await expect(
        page.getByRole('button', { name, exact: typeof name === 'string' })
      ).toBeFocused()
    }
    await trigger().focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menuitemradio')).toHaveCount(4)
    await expect(page.getByRole('menuitemradio').last()).toHaveAttribute('aria-checked', 'true')
    if (footer) {
      await expect(page.getByText('Permissions for this chat', { exact: true })).toBeVisible()
    }
    await capture(`${variant}-open`, true)
    await page.keyboard.press('Escape')
    await expect(trigger()).toBeFocused()
    await expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    await capture(`${variant}-focus`)
    await page.getByRole('textbox').focus()
    await trigger().hover()
    await capture(`${variant}-hover`)
    await trigger().click()
    await page.getByRole('menuitemradio').first().click()
    await expect(trigger()).toHaveAttribute('aria-label', accessible(labels[0]))
    await page.getByRole('textbox').focus()
    await page.mouse.move(0, 0)
    await capture(`${variant}-ask`)
    for (let index = 0; index < labels.length; index++) {
      await trigger().focus()
      await page.keyboard.press('Enter')
      await page.keyboard.press('Home')
      await expect(page.getByRole('menuitemradio').first()).toBeFocused()
      for (let step = 0; step < index; step++) {
        await page.keyboard.press('ArrowDown')
        await expect(page.getByRole('menuitemradio').nth(step + 1)).toBeFocused()
      }
      await expect(page.getByRole('menuitemradio').nth(index)).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(trigger()).toHaveAttribute('aria-label', accessible(labels[index]))
      await trigger().click()
      await expect(page.getByRole('menuitemradio').nth(index)).toHaveAttribute(
        'aria-checked',
        'true'
      )
      await expect(page.locator('[role="menuitemradio"][aria-checked="true"]')).toHaveCount(1)
      await page.keyboard.press('Escape')
      await expect(trigger()).toBeFocused()
    }
    await expect(page.getByRole('textbox')).toHaveText(draft)
    await load(variant, 1440, 14, false, true)
    await expect(trigger()).toBeDisabled()
    await capture(`${variant}-disabled`)
    report.checks.push(
      `${variant}: actual Tab order, all four modes, exactly one selected radio, Escape/focus return, draft preservation, disabled picker`
    )

    for (const context of ['remote', 'local', 'folder', 'long']) {
      for (const width of [360, 520, 900]) {
        for (const fontSize of [14, 20]) {
          for (const coarse of [false, true]) {
            await load(variant, width, fontSize, coarse, false, context)
            const geometry = await page.evaluate(() => {
              const composer = document
                .querySelector('[role="textbox"]')
                .closest('.border-chat-composer-border')
              const row = document.querySelector('[data-permission-context-row]')
              const permission = [...document.querySelectorAll('button')].find((b) =>
                b.getAttribute('aria-label')?.startsWith('Permissions ')
              )
              const box = (el) => {
                const { x, y, width, height } = el.getBoundingClientRect()
                return { x, y, width, height }
              }
              const buttons = [...composer.querySelectorAll('button')]
              return {
                overflow: document.documentElement.scrollWidth > innerWidth,
                coarse: matchMedia('(pointer: coarse)').matches,
                composer: box(composer),
                row: box(row),
                permission: box(permission),
                permissionInFooter: row.contains(permission),
                permissionTextClipped: [...permission.querySelectorAll('span')].some(
                  (el) => el.scrollWidth > el.clientWidth + 1
                ),
                buttons: buttons.map((el) => ({
                  label: el.getAttribute('aria-label'),
                  ...box(el)
                })),
                metadata: [
                  ...row.querySelectorAll(
                    '[data-context-host], [data-context-workspace], [data-context-branch]'
                  )
                ].map((el) => ({ text: el.textContent, ...box(el) })),
                branchCount: row.querySelectorAll('[data-context-branch]').length,
                host: row.querySelector('[data-context-host]').textContent
              }
            })
            expect(geometry.overflow).toBe(false)
            expect(geometry.coarse).toBe(coarse)
            expect(geometry.permissionInFooter).toBe(footer)
            expect(geometry.buttons.map((button) => button.label)).toEqual(
              footer
                ? [
                    'Attach file',
                    expect.stringMatching(/^Model Opus 5.5/),
                    'Start dictation',
                    'Send'
                  ]
                : [
                    'Attach file',
                    'Permissions Full access',
                    expect.stringMatching(/^Model Opus 5.5/),
                    'Start dictation',
                    'Send'
                  ]
            )
            expect(geometry.branchCount).toBe(context === 'folder' ? 0 : 1)
            expect(geometry.host).toBe(
              ['local', 'folder'].includes(context) ? 'This computer' : 'Demo Server'
            )
            expect(geometry.row.y).toBeGreaterThanOrEqual(
              geometry.composer.y + geometry.composer.height
            )
            expect(geometry.row.y + geometry.row.height).toBeLessThanOrEqual(900)
            expect(geometry.permission.height).toBeCloseTo(((coarse ? 44 : 32) * fontSize) / 14, 1)
            if (footer) {
              expect(geometry.permissionTextClipped).toBe(false)
              expect(geometry.permission.x + geometry.permission.width).toBeCloseTo(
                geometry.row.x + geometry.row.width,
                0
              )
            }
            const boxes = [
              ...geometry.buttons,
              ...geometry.metadata,
              ...(footer ? [geometry.permission] : [])
            ]
            for (const [i, a] of boxes.entries()) {
              expect(a.width).toBeGreaterThan(0)
              expect(a.x).toBeGreaterThanOrEqual(0)
              expect(a.x + a.width).toBeLessThanOrEqual(width + 1)
              for (const b of boxes.slice(i + 1)) {
                expect(
                  Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1 &&
                    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1
                ).toBe(false)
              }
            }
            if (context === 'remote' && width === 360 && !coarse) {
              await capture(`${variant}-360-${fontSize}-closed`)
            }
            if (
              variant === 'footer-sliders' &&
              width === 520 &&
              fontSize === 14 &&
              !coarse &&
              context !== 'remote'
            ) {
              await capture(`${variant}-${context}-closed`)
            }
            await trigger().click()
            await expect(page.getByRole('menu')).toBeVisible()
            await page.waitForTimeout(100)
            const menu = await page.getByRole('menu').boundingBox()
            expect(menu.x).toBeGreaterThanOrEqual(0)
            expect(menu.x + menu.width).toBeLessThanOrEqual(width + 1)
            expect(menu.y).toBeGreaterThanOrEqual(0)
            expect(menu.y + menu.height).toBeLessThanOrEqual(geometry.permission.y + 1)
            if (context === 'remote' && width === 360 && fontSize === 14 && !coarse) {
              await capture(`${variant}-360-open`, true)
            }
            await page.keyboard.press('Escape')
            await expect(trigger()).toBeFocused()
            report.layouts.push({ variant, width, fontSize, coarse, context, geometry, menu })
          }
        }
      }
      console.log(
        `Checked ${variant}/${context}: 12 layouts, no overlaps, host visible, upward menus`
      )
    }
  }
  for (const state of ['error', 'working', 'dictating', 'disabled']) {
    await load('footer-sliders', 900, 14, false, false, 'remote', state)
    await capture(`footer-sliders-${state}-view`, false, true)
    const draft = await page.getByRole('textbox').textContent()
    await trigger().click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('textbox')).toHaveText(draft)
    if (state === 'error') {
      const retry = page.getByRole('button', { name: 'Retry', exact: true })
      const editor = await page.getByRole('textbox').boundingBox()
      expect((await retry.boundingBox()).y).toBeLessThan(editor.y)
      await retry.click()
      await expect(retry).toHaveCount(0)
    }
    if (state === 'working') {
      await page.getByRole('button', { name: 'Stop the agent', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
    }
    if (state === 'disabled') {
      for (const name of ['Attach file', 'Start dictation', 'Send']) {
        await expect(page.getByRole('button', { name, exact: true })).toBeDisabled()
      }
    }
    report.checks.push(
      `footer-sliders/${state}: picker and draft remain independent of composer state`
    )
  }
  for (const model of ['openai', 'unknown']) {
    await load('footer-sliders', 1440, 14, false, false, 'remote', 'idle', model)
    await capture(`footer-sliders-${model}`)
    const glyph = page.locator('[data-model-family]')
    await (model === 'unknown'
      ? expect(glyph).toHaveCount(0)
      : expect(glyph).toHaveAttribute('data-model-family', 'openai'))
    report.checks.push(`${model}: original model-family identity preserved`)
  }
}
