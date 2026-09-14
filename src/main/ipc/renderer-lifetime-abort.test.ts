import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import {
  abortWhenRendererGone,
  RENDERER_GONE_MESSAGE,
  type RendererLifetimeSender
} from './renderer-lifetime-abort'

function fakeSender(): RendererLifetimeSender & EventEmitter {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: EventEmitter implements the once/on/removeListener surface this helper uses, and those three are all it calls; WebContents' overloaded signatures cannot be satisfied structurally.
  return new EventEmitter() as RendererLifetimeSender & EventEmitter
}

describe('abortWhenRendererGone', () => {
  it('aborts when the renderer is destroyed', () => {
    const sender = fakeSender()
    const { signal } = abortWhenRendererGone(sender)

    expect(signal.aborted).toBe(false)
    sender.emit('destroyed')

    expect(signal.aborted).toBe(true)
    expect(String(signal.reason)).toContain(RENDERER_GONE_MESSAGE)
  })

  it('aborts when the render process is gone', () => {
    const sender = fakeSender()
    const { signal } = abortWhenRendererGone(sender)

    sender.emit('render-process-gone')

    expect(signal.aborted).toBe(true)
  })

  it('aborts on a reload but not on in-app route changes', () => {
    const sender = fakeSender()
    const { signal } = abortWhenRendererGone(sender)

    sender.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
    sender.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false })
    expect(signal.aborted).toBe(false)

    sender.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    expect(signal.aborted).toBe(true)
  })

  it('leaves no listeners on a long-lived renderer once disposed', () => {
    const sender = fakeSender()
    const { dispose } = abortWhenRendererGone(sender)

    expect(sender.listenerCount('destroyed')).toBe(1)
    dispose()
    dispose()

    expect(sender.listenerCount('destroyed')).toBe(0)
    expect(sender.listenerCount('render-process-gone')).toBe(0)
    expect(sender.listenerCount('did-start-navigation')).toBe(0)
  })
})
