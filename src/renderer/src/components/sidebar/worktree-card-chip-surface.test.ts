import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { WorktreeHostContextBadge } from './WorktreeHostContextBadge'

const testDir = import.meta.dirname

function readCss(): string {
  // Strip comments so a `}` inside prose can't truncate a rule body match.
  return readFileSync(resolve(testDir, '../../assets/main.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    ''
  )
}

function readRuleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const body = readCss().match(new RegExp(`^${escaped}\\s*\\{(?<body>[^}]*)\\}`, 'm'))?.groups?.body
  expect(body, `missing CSS rule for ${selector}`).toBeTypeOf('string')

  return body ?? ''
}

function readDeclaration(selector: string, property: string): string {
  const body = readRuleBody(selector)
  const value = body.match(new RegExp(`(?:^|;)\\s*${property}:\\s*(?<value>[^;]*)`))?.groups?.value

  return (value ?? '').trim()
}

const CHIP_BACKGROUNDS = [
  ['.worktree-sidebar-chip', 'color-mix(in srgb, var(--foreground) 8%, transparent)'],
  ['.dark .worktree-sidebar-chip', 'color-mix(in srgb, var(--foreground) 12%, transparent)']
] as const
const CHIP_LABEL_FOREGROUND_PERCENT = 70
const CHIP_LABEL_COLOR = `color-mix(in srgb, var(--foreground) ${CHIP_LABEL_FOREGROUND_PERCENT}%, transparent)`
// Selected-card values from #15971's default-light and Match-terminal-dark cases.
const CHIP_LABEL_CONTRAST_CASES = [
  ['default light', '.worktree-sidebar-chip', 10, 226],
  ['Match-terminal dark', '.dark .worktree-sidebar-chip', 250, 45]
] as const

function linearizeSrgb(channel: number): number {
  const normalized = channel / 255
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
}

function grayscaleContrast(first: number, second: number): number {
  const firstLuminance = linearizeSrgb(first)
  const secondLuminance = linearizeSrgb(second)
  const lighter = Math.max(firstLuminance, secondLuminance)
  const darker = Math.min(firstLuminance, secondLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

describe('worktree sidebar chip surface', () => {
  it.each(CHIP_BACKGROUNDS)('keeps %s theme-relative and layer-relative', (selector, expected) => {
    expect(readDeclaration(selector, 'background')).toBe(expected)
  })

  it('inherits the sleeping-card foreground instead of bypassing its dim', () => {
    expect(readRuleBody('[data-worktree-sleeping-dim]')).toMatch(/--foreground:\s*color-mix\(/)

    for (const [selector] of CHIP_BACKGROUNDS) {
      const background = readDeclaration(selector, 'background')
      expect(background).toContain('var(--foreground)')
      expect(background).not.toContain('var(--worktree-sidebar-foreground)')
    }
  })

  it('keeps the host label layer-relative to its chip surface', () => {
    expect(readDeclaration('.worktree-sidebar-chip-label', 'color')).toBe(CHIP_LABEL_COLOR)
  })

  it.each(CHIP_LABEL_CONTRAST_CASES)(
    'keeps the label contrast above AA in %s',
    (_, chipSelector, foreground, selectedCard) => {
      const chipFill = readDeclaration(chipSelector, 'background')
      const chipForegroundPercent = chipFill.match(/var\(--foreground\) (?<percent>\d+)%/)?.groups
        ?.percent
      expect(chipForegroundPercent).toBeTypeOf('string')

      const chipShare = Number(chipForegroundPercent) / 100
      const chip = foreground * chipShare + selectedCard * (1 - chipShare)
      const labelShare = CHIP_LABEL_FOREGROUND_PERCENT / 100
      const label = foreground * labelShare + chip * (1 - labelShare)

      expect(grayscaleContrast(label, chip)).toBeGreaterThanOrEqual(4.5)
    }
  )

  it('keeps the chip border out of the way instead of tinting it', () => {
    expect(readDeclaration('.worktree-sidebar-chip', 'border-color')).toBe('transparent')
  })

  it('applies the shared surface to host and repository chips', () => {
    const hostMarkup = renderToStaticMarkup(
      createElement(WorktreeHostContextBadge, { label: 'Remote Mac' })
    )
    const metaRowSource = readFileSync(resolve(testDir, 'worktree-card-meta-row.tsx'), 'utf8')

    expect(hostMarkup).toMatch(/class="[^"]*\bworktree-sidebar-chip\b/)
    expect(hostMarkup).toMatch(/class="[^"]*\bworktree-sidebar-chip-label\b/)
    expect(hostMarkup).not.toMatch(/class="[^"]*\btext-muted-foreground\b/)
    expect(metaRowSource.match(/worktree-sidebar-chip(?=[\s"'])/g)).toHaveLength(1)
    expect(metaRowSource).not.toMatch(/\bbg-accent\b/)
    expect(metaRowSource).not.toMatch(/\bborder-border\b/)
  })
})
