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

  it('keeps the chip border out of the way instead of tinting it', () => {
    expect(readDeclaration('.worktree-sidebar-chip', 'border-color')).toBe('transparent')
  })

  it('applies the shared surface to host and repository chips', () => {
    const hostMarkup = renderToStaticMarkup(
      createElement(WorktreeHostContextBadge, { label: 'Remote Mac' })
    )
    const metaRowSource = readFileSync(resolve(testDir, 'worktree-card-meta-row.tsx'), 'utf8')

    expect(hostMarkup).toMatch(/class="[^"]*\bworktree-sidebar-chip\b/)
    expect(hostMarkup).toMatch(/class="[^"]*\btext-muted-foreground\b/)
    expect(metaRowSource.match(/worktree-sidebar-chip(?=[\s"'])/g)).toHaveLength(1)
    expect(metaRowSource).not.toMatch(/\bbg-accent\b/)
    expect(metaRowSource).not.toMatch(/\bborder-border\b/)
  })
})
