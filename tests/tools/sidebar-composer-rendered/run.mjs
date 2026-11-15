import { _electron as electron, expect } from '@stablyai/playwright-test'
import { build as buildMain } from 'esbuild'
import { build as buildRenderer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { markdownParserAliases } from '../../../config/build-plugins/markdown-parser-exports.ts'
import { checkPermissionPreviews } from './permission-previews.mjs'
import { checkFooterPreviews } from './footer-previews.mjs'

const permissionPreviews =
  process.env.PERMISSION_PREVIEWS === '1' || process.env.FOOTER_PREVIEWS === '1'

if (process.env.ORCA_BACKGROUND_LAUNCH !== '1') {
  throw new Error('Requires ORCA_BACKGROUND_LAUNCH=1')
}
const root = fileURLToPath(new URL('../../../', import.meta.url))
const parent = path.join(root, '.bench-fixtures')
mkdirSync(parent, { recursive: true })
const output = mkdtempSync(path.join(parent, 'sidebar-composer-'))
const main = path.join(output, 'main.cjs')
const report = {
  scope:
    'Production workspace cards, composer field and approval card. Synthetic conversation and fixture frame; no live agents or transport.',
  captures: [],
  errors: []
}
console.log(`Building prototype: ${output}`)
await buildMain({
  entryPoints: [path.join(root, 'tests/tools/benchmarks/spinner-rendering/main.ts')],
  outfile: main,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron']
})
await buildRenderer({
  configFile: false,
  root: import.meta.dirname,
  base: './',
  logLevel: 'warn',
  plugins: [
    {
      name: 'permission-preview-only',
      enforce: 'pre',
      resolveId(source, importer) {
        if (
          permissionPreviews &&
          source === './NativeChatPermissionModePicker' &&
          importer ===
            path.join(root, 'src/renderer/src/components/native-chat/NativeChatComposerActions.tsx')
        ) {
          return path.join(import.meta.dirname, 'permission-previews.tsx')
        }
        return null
      },
      transform(code, id) {
        if (
          process.env.FOOTER_PREVIEWS !== '1' ||
          id !==
            path.join(root, 'src/renderer/src/components/native-chat/NativeChatComposerField.tsx')
        ) {
          return null
        }
        const end = '          </div>\n        </div>\n      </div>\n    </div>\n  )\n}'
        if (code.split(end).length !== 2) {
          throw new Error(
            'Composer footer insertion point changed; inspect before updating the preview'
          )
        }
        const fixture = JSON.stringify(path.join(import.meta.dirname, 'permission-context-row.tsx'))
        return {
          code: `import { PermissionContextRow } from ${fixture}\n${code.replace(
            end,
            '          </div>\n          <PermissionContextRow />\n        </div>\n      </div>\n    </div>\n  )\n}'
          )}`,
          map: null
        }
      }
    },
    {
      name: 'prototype-baseline-source',
      enforce: 'pre',
      load(id) {
        if (!process.env.PROTOTYPE_BASELINE) {
          return null
        }
        const relative = path.relative(root, id)
        if (!relative.startsWith(`src${path.sep}`)) {
          return null
        }
        const source = path.join(process.env.PROTOTYPE_BASELINE, relative)
        return existsSync(source) ? readFileSync(source, 'utf8') : null
      }
    },
    react(),
    tailwindcss()
  ],
  define: { ORCA_FEATURE_WALL_ENABLED: 'true', ORCA_BUILD_COMMIT: JSON.stringify('prototype') },
  resolve: {
    alias: {
      ...markdownParserAliases,
      '@': path.join(root, 'src/renderer/src'),
      '@renderer': path.join(root, 'src/renderer/src')
    }
  },
  build: { outDir: path.join(output, 'renderer'), emptyOutDir: true, chunkSizeWarningLimit: 10000 }
})
const { ELECTRON_RUN_AS_NODE: _runAsNode, ...env } = process.env
const app = await electron.launch({ args: [main], env: { ...env, ORCA_BACKGROUND_LAUNCH: '1' } })
try {
  const page = await app.firstWindow()
  page.on('pageerror', (error) => {
    report.errors.push(error.message)
    console.error(error)
  })
  const cdp = await page.context().newCDPSession(page)
  if (process.env.FOOTER_PREVIEWS === '1') {
    await checkFooterPreviews({ app, page, cdp, output, report })
  } else if (permissionPreviews) {
    await checkPermissionPreviews({ app, page, cdp, output, report })
  }
  for (const [name, width, height, state, model] of permissionPreviews
    ? []
    : [
        ['wide', 1440, 900, 'idle'],
        ['openai', 1440, 900, 'idle', 'openai'],
        ['unknown', 1440, 900, 'idle', 'unknown'],
        ['narrow', 900, 800, 'idle'],
        ['working', 1440, 900, 'working'],
        ['dictating', 1440, 900, 'dictating'],
        ['disabled', 1440, 900, 'disabled'],
        ['approval', 1440, 900, 'approval'],
        ['error', 900, 800, 'error'],
        ['mobile', 520, 800, 'error']
      ]) {
    await app.evaluate(
      ({ BrowserWindow }, dimensions) => {
        BrowserWindow.getAllWindows()[0].setSize(...dimensions)
      },
      [width, height]
    )
    const url = pathToFileURL(path.join(output, 'renderer/index.html'))
    url.searchParams.set('state', state)
    if (model) {
      url.searchParams.set('model', model)
    }
    await page.goto(url.href)
    await expect(page.getByRole('heading', { name: 'Polish the workspace sidebar' })).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    await expect(
      state === 'approval'
        ? page.getByRole('button', { name: 'Allow once' })
        : page.getByRole('textbox')
    ).toBeVisible()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(path.join(output, `${name}.png`), Buffer.from(data, 'base64'))
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (['wide', 'openai', 'unknown', 'working', 'dictating', 'disabled'].includes(name)) {
      const bounds = await page.getByRole('textbox').evaluate((element) => {
        const rect = element.closest('.border-chat-composer-border').getBoundingClientRect()
        return {
          x: rect.x - 8,
          y: rect.y - 8,
          width: rect.width + 16,
          height: rect.height + 16,
          scale: 1
        }
      })
      const crop = await cdp.send('Page.captureScreenshot', { format: 'png', clip: bounds })
      writeFileSync(path.join(output, `${name}-composer.png`), Buffer.from(crop.data, 'base64'))
      if (name === 'wide') {
        const sidebar = await cdp.send('Page.captureScreenshot', {
          format: 'png',
          clip: { x: 0, y: 48, width: 280, height: 420, scale: 1 }
        })
        writeFileSync(path.join(output, 'sidebar.png'), Buffer.from(sidebar.data, 'base64'))
      }
      if (!process.env.PROTOTYPE_BASELINE) {
        const glyph = page.locator('[data-model-family]')
        await (model === 'unknown'
          ? expect(glyph).toHaveCount(0)
          : expect(glyph).toHaveAttribute(
              'data-model-family',
              model === 'openai' ? 'openai' : 'claude'
            ))
      }
    }
    report.captures.push(name)
    console.log(`Captured ${name} (${width}×${height})`)
    if (state === 'error') {
      await page.getByRole('button', { name: 'Retry' }).click()
      await expect(
        page.getByText('Your message was not sent. The server is disconnected.')
      ).toHaveCount(0)
      await expect(page.getByRole('textbox')).toContainText('Keep the task title clear')
    }
    if (state === 'working') {
      await page.getByRole('button', { name: 'Stop the agent' }).click()
      await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
    }
    if (state === 'approval') {
      await page.getByRole('button', { name: 'Allow once' }).click()
      await expect(page.getByRole('textbox')).toBeVisible()
    }
  }
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
  console.log(`Prototype evidence: ${output}`)
  await app.close()
}
