import { expect } from '@stablyai/playwright-test'
import { writeFileSync } from 'node:fs'
import path from 'node:path'

/** Exercise fixture-only handlers; no microphone, file dialog, agent or transport is started. */
export async function checkComposerControls({ page, cdp, load, report, output }) {
  report.controls = []
  const attach = () => page.getByRole('button', { name: 'Attach file', exact: true })
  const mic = () => page.getByRole('button', { name: /^(Start|Stop) dictation$/ })
  const action = () => page.getByRole('button', { name: /^(Send|Stop the agent)$/ })
  const geometry = () =>
    page.evaluate(() => {
      const button = (prefix) =>
        [...document.querySelectorAll('button')].find((element) =>
          prefix.test(element.getAttribute('aria-label') ?? '')
        )
      const box = (element) => {
        const { x, y, width, height } = element.getBoundingClientRect()
        return { x, y, width, height }
      }
      const details = (element) => {
        const style = getComputedStyle(element)
        const glyph = element.querySelector('svg')
        return {
          ...box(element),
          fontSize: style.fontSize,
          fontWeight: getComputedStyle(element.querySelector('.truncate') ?? element).fontWeight,
          gap: style.gap,
          color: style.color,
          opacity: style.opacity,
          background: style.backgroundColor,
          glyph: glyph ? box(glyph) : null,
          stroke: glyph ? getComputedStyle(glyph).strokeWidth : null
        }
      }
      const send = button(/^(Send|Stop the agent)$/)
      return {
        coarse: matchMedia('(pointer: coarse)').matches,
        attach: details(button(/^Attach file$/)),
        mic: details(button(/^(Start|Stop) dictation$/)),
        permission: details(button(/^Permissions /)),
        model: details(button(/^Model /)),
        action: details(send.querySelector('span[aria-hidden]')),
        actionHit: box(send)
      }
    })
  const settle = () => page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 200)))
  for (const coarse of [false, true]) {
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: coarse })
    for (const fontSize of [14, 20]) {
      await load()
      await page.evaluate((size) => {
        const chat = document.querySelector('.native-chat-appearance')
        chat.style.setProperty('--chat-font-size', `${size}px`)
        chat.style.setProperty('--chat-ui-font-size', `${size}px`)
      }, fontSize)
      await page.mouse.move(0, 0)
      await settle()
      const idle = await geometry()
      const scale = fontSize / 14
      const target = (coarse ? 44 : 32) * scale
      expect(idle.coarse).toBe(coarse)
      for (const control of [idle.attach, idle.mic, idle.permission, idle.model, idle.actionHit]) {
        expect(control.height).toBeCloseTo(target, 1)
      }
      expect(idle.action.width).toBeCloseTo(28 * scale, 1)
      expect(idle.actionHit.width).toBeCloseTo(target, 1)
      expect(idle.action.x + idle.action.width / 2).toBeCloseTo(
        idle.actionHit.x + idle.actionHit.width / 2,
        1
      )
      expect(idle.permission.fontSize).toBe(idle.model.fontSize)
      expect(idle.permission.fontWeight).toBe('400')
      expect(idle.permission.gap).toBe(idle.model.gap)
      expect(idle.permission.glyph.width).toBeCloseTo(14 * scale, 1)
      expect(idle.attach.glyph.width).toBeCloseTo(16 * scale, 1)
      expect(idle.mic.glyph.width).toBeCloseTo(16 * scale, 1)
      expect(idle.attach.color).toBe(idle.mic.color)
      expect(idle.attach.stroke).toBe(idle.mic.stroke)
      expect(idle.attach.opacity).toBe('1')
      expect(idle.mic.opacity).toBe('1')
      await attach().hover()
      await settle()
      const attachHover = (await geometry()).attach
      await mic().hover()
      await settle()
      const micHover = (await geometry()).mic
      expect(attachHover.color).toBe(micHover.color)
      expect(attachHover.background).toBe(micHover.background)

      await mic().focus()
      await page.keyboard.press('Enter')
      await expect(mic()).toHaveAttribute('aria-label', 'Stop dictation')
      const recording = await geometry()
      expect(recording.mic.width).toBe(idle.mic.width)
      expect(recording.mic.height).toBe(idle.mic.height)
      expect(recording.actionHit).toEqual(idle.actionHit)
      await page.keyboard.press('Enter')
      await expect(page.getByRole('textbox')).toContainText('Sample dictated text.')
      await attach().focus()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('textbox')).toContainText('@sample-notes.txt')

      // Stay a full CSS pixel inside fractional edges, which Chromium snaps for hit testing.
      const hit = (await geometry()).actionHit
      const hitSamples = []
      for (const [x, y] of [
        [hit.x + 1, hit.y + hit.height / 2],
        [hit.x + hit.width - 1, hit.y + hit.height / 2],
        [hit.x + hit.width / 2, hit.y + 1],
        [hit.x + hit.width / 2, hit.y + hit.height - 1]
      ]) {
        const hitTest = await page.evaluate(
          ({ x, y }) => {
            const target = document.elementFromPoint(x, y)
            return {
              tag: target?.tagName,
              label: target?.closest('button')?.getAttribute('aria-label')
            }
          },
          { x, y }
        )
        hitSamples.push({ x, y, ...hitTest })
        expect(hitTest.label).toBe('Send')
        await page.mouse.click(x, y)
        await expect(action()).toHaveAttribute('aria-label', 'Stop the agent')
        const working = await geometry()
        expect(working.actionHit).toEqual(hit)
        expect(working.action.width).toBe(idle.action.width)
        await action().focus()
        await page.keyboard.press('Enter')
        await expect(action()).toHaveAttribute('aria-label', 'Send')
      }
      report.controls.push({ fontSize, coarse, idle, recording, hitSamples })
      if (!coarse && fontSize === 14) {
        const capture = async (name) => {
          const clip = await page.getByRole('textbox').evaluate((element) => {
            const rect = element.closest('.border-chat-composer-border').getBoundingClientRect()
            return {
              x: rect.x - 8,
              y: rect.y - 8,
              width: rect.width + 16,
              height: rect.height + 16,
              scale: 1
            }
          })
          const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip })
          writeFileSync(path.join(output, name), Buffer.from(data, 'base64'))
        }
        await page.getByRole('textbox').focus()
        await action().hover()
        await settle()
        await capture('send-hover.png')
        await action().focus()
        await page.keyboard.press('Shift+Tab')
        await page.keyboard.press('Tab')
        await expect(action()).toBeFocused()
        expect(await action().evaluate((element) => element.matches(':focus-visible'))).toBe(true)
        await page.mouse.move(0, 0)
        await settle()
        await capture('send-keyboard-focus.png')
      }
      console.log(
        `Checked control targets/states: ${fontSize}px text, ${coarse ? 'coarse' : 'fine'} pointer`
      )
    }
  }
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false })
  await load('disabled')
  const draft = await page.getByRole('textbox').textContent()
  for (const control of [attach(), mic(), action()]) {
    await expect(control).toBeDisabled()
    const bounds = await control.boundingBox()
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  }
  await expect(page.getByRole('textbox')).toHaveText(draft)
  await expect(mic()).toHaveAttribute('aria-label', 'Start dictation')
  await expect(action()).toHaveAttribute('aria-label', 'Send')
  const disabled = await geometry()
  expect(disabled.attach.opacity).toBe('0.5')
  expect(disabled.mic.opacity).toBe('0.5')
  const { x, y, height } = disabled.actionHit
  await page.mouse.click(x + 0.5, y + height / 2)
  await expect(action()).toHaveAttribute('aria-label', 'Send')
  await load('hold')
  await mic().hover()
  await page.mouse.down()
  await expect(mic()).toHaveAttribute('aria-label', 'Stop dictation')
  await page.mouse.up()
  await expect(mic()).toHaveAttribute('aria-label', 'Start dictation')
  await expect(page.getByRole('textbox')).toContainText('Sample dictated text.')
  await mic().hover()
  await page.mouse.down()
  await page.mouse.move(0, 0)
  await expect(mic()).toHaveAttribute('aria-label', 'Start dictation')
  await page.mouse.up()
  report.checks.push(
    'Enabled attachment/dictation sample actions; disabled actions inert; hold release/leave stops dictation',
    '28px painted Send/Stop, 32px fine and 44px coarse targets scale with chat text; all four padded edges work',
    'Matched action glyphs/hover and picker metrics; stable Send/Stop and recording footprints'
  )
}
