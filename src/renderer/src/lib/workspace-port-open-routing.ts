/**
 * Where a click on a port row lands: Orca's embedded browser, the system browser, or —
 * for users who inverted the modifier — the other way round. Kept apart from the port
 * actions themselves because every ports surface needs the decision and the matching
 * tooltip, while only some of them open anything.
 */
export function shouldOpenWorkspacePortInOrcaBrowser(
  settings: { openLinksInApp?: boolean } | null | undefined
): boolean {
  return settings?.openLinksInApp === true
}

function isMacShortcutPlatform(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')
}

export function getPortSystemBrowserHint(isMac: boolean = isMacShortcutPlatform()): string {
  return isMac ? '⇧⌘+click for system browser' : 'Shift+Ctrl+click for system browser'
}

/** Mirror of the system-browser hint for users who inverted the modifier, where a plain
 *  click already leaves Orca and the modifier is what brings the page back in. */
export function getPortOpenOrcaBrowserHint(isMac: boolean = isMacShortcutPlatform()): string {
  return isMac ? '⇧⌘+click to open in Orca' : 'Shift+Ctrl+click to open in Orca'
}

/** Where Shift+Cmd/Ctrl+click on a port lands, or null when it has nothing to offer. */
export type PortOpenModifierDestination = 'system-browser' | 'orca' | null

type PortLinkRoutingSettings = {
  openLinksInApp?: boolean
  openLinksInAppModifierInverts?: boolean
}

/**
 * Why both inputs: with Link Routing off and inverting on, the modifier means "the other
 * one" — Orca — exactly as it does for terminal, markdown and check links, so naming the
 * system browser there is backwards. And a remote port with no client-reachable address
 * has no system browser to offer at all, so the modifier would silently do nothing.
 */
export function resolvePortOpenModifierDestination(
  settings: PortLinkRoutingSettings | null | undefined,
  systemBrowserAvailable = true
): PortOpenModifierDestination {
  if (settings?.openLinksInApp !== true && settings?.openLinksInAppModifierInverts === true) {
    return 'orca'
  }
  return systemBrowserAvailable ? 'system-browser' : null
}

export function getPortOpenBrowserTooltipLabel(
  openLabel: string,
  options: { isMac?: boolean; modifierDestination?: PortOpenModifierDestination } = {}
): string {
  const destination =
    options.modifierDestination === undefined ? 'system-browser' : options.modifierDestination
  if (destination === null) {
    return openLabel
  }
  const hint =
    destination === 'orca'
      ? getPortOpenOrcaBrowserHint(options.isMac)
      : getPortSystemBrowserHint(options.isMac)
  return `${openLabel}. ${hint}`
}

type PortOpenClickEvent = Pick<MouseEvent, 'metaKey' | 'ctrlKey' | 'shiftKey'>

export type PortOpenRouting = {
  /** Whether this open should land in Orca's embedded browser. */
  openInOrcaBrowser: boolean
  /** True only when the user explicitly asked for the system browser with the modifier.
   *  Distinct from `openInOrcaBrowser === false`, which is also the stock-settings plain
   *  click — a remote port must not leave Orca just because Link Routing is off. */
  systemBrowserRequested: boolean
}

function isPortSystemBrowserModifier(event: PortOpenClickEvent, isMac: boolean): boolean {
  return event.shiftKey && (isMac ? event.metaKey : event.ctrlKey)
}

export function resolvePortOpenRouting({
  settings,
  event,
  isMac
}: {
  settings: PortLinkRoutingSettings | null | undefined
  event?: PortOpenClickEvent | null
  isMac: boolean
}): PortOpenRouting {
  // Why: Shift+Cmd/Ctrl is the escape hatch; no pointer event means context-menu and
  // keyboard opens should keep the saved setting.
  if (!event || !isPortSystemBrowserModifier(event, isMac)) {
    return {
      openInOrcaBrowser: shouldOpenWorkspacePortInOrcaBrowser(settings),
      systemBrowserRequested: false
    }
  }
  if (resolvePortOpenModifierDestination(settings) === 'orca') {
    return { openInOrcaBrowser: true, systemBrowserRequested: false }
  }
  return { openInOrcaBrowser: false, systemBrowserRequested: true }
}

export function resolvePortOpenInOrcaBrowser(args: {
  settings: PortLinkRoutingSettings | null | undefined
  event?: PortOpenClickEvent | null
  isMac: boolean
}): boolean {
  return resolvePortOpenRouting(args).openInOrcaBrowser
}
