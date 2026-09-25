import { describe, expect, it } from 'vitest'
import {
  getPortOpenBrowserTooltipLabel,
  resolvePortOpenModifierDestination,
  resolvePortOpenRouting
} from './workspace-port-open-routing'

function clickEvent(overrides: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean } = {}) {
  return { metaKey: false, ctrlKey: false, shiftKey: false, ...overrides }
}

describe('resolvePortOpenRouting', () => {
  it('separates the stock plain click from an explicit system-browser request', () => {
    expect(
      resolvePortOpenRouting({
        settings: { openLinksInApp: false },
        event: clickEvent(),
        isMac: true
      })
    ).toEqual({ openInOrcaBrowser: false, systemBrowserRequested: false })
    expect(
      resolvePortOpenRouting({
        settings: { openLinksInApp: false },
        event: clickEvent({ metaKey: true, shiftKey: true }),
        isMac: true
      })
    ).toEqual({ openInOrcaBrowser: false, systemBrowserRequested: true })
  })

  it('sends the modifier to Orca for users who inverted it, matching every other link', () => {
    expect(
      resolvePortOpenRouting({
        settings: { openLinksInApp: false, openLinksInAppModifierInverts: true },
        event: clickEvent({ ctrlKey: true, shiftKey: true }),
        isMac: false
      })
    ).toEqual({ openInOrcaBrowser: true, systemBrowserRequested: false })
  })

  it('keeps no-pointer activations on the saved setting', () => {
    expect(
      resolvePortOpenRouting({ settings: { openLinksInApp: true }, event: null, isMac: true })
    ).toEqual({ openInOrcaBrowser: true, systemBrowserRequested: false })
  })
})

describe('getPortOpenBrowserTooltipLabel', () => {
  it('advertises the modifier when the system browser can serve the port', () => {
    expect(
      getPortOpenBrowserTooltipLabel('Open in Browser', {
        isMac: true,
        modifierDestination: resolvePortOpenModifierDestination({ openLinksInApp: false }, true)
      })
    ).toBe('Open in Browser. ⇧⌘+click for system browser')
  })

  it('drops the hint when no reachable address exists, rather than promising a no-op', () => {
    expect(
      getPortOpenBrowserTooltipLabel('Open in Browser', {
        isMac: true,
        modifierDestination: resolvePortOpenModifierDestination({ openLinksInApp: false }, false)
      })
    ).toBe('Open in Browser')
  })

  it('names Orca for users who inverted the modifier, instead of the system browser', () => {
    expect(
      getPortOpenBrowserTooltipLabel('Open in Browser', {
        isMac: false,
        modifierDestination: resolvePortOpenModifierDestination({
          openLinksInApp: false,
          openLinksInAppModifierInverts: true
        })
      })
    ).toBe('Open in Browser. Shift+Ctrl+click to open in Orca')
  })
})
