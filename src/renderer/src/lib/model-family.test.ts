import { describe, expect, it } from 'vitest'
import { modelFamilyFromId } from './model-family'

describe('modelFamilyFromId', () => {
  it.each([
    'opus',
    'sonnet',
    'haiku',
    'fable',
    'opus[1m]',
    'claude-sonnet-5',
    'claude-3-7-sonnet',
    'anthropic/claude-opus-5-5',
    'cliproxy/claude-opus-5-5',
    'openrouter/anthropic/claude-sonnet-5'
  ])('recognizes the Claude model ID %s', (id) => {
    expect(modelFamilyFromId(id)).toBe('claude')
  })

  it.each([
    'gpt-5.4',
    'gpt-6.1-terra',
    'o3',
    'o4-mini',
    'openai-codex/gpt-6.1-terra',
    'cliproxy/gpt-5.4',
    'openrouter/openai/gpt-5.4'
  ])('recognizes the OpenAI model ID %s', (id) => {
    expect(modelFamilyFromId(id)).toBe('openai')
  })

  it.each([
    undefined,
    null,
    '',
    'default',
    'pi',
    'claude',
    'openai',
    'anthropic/custom',
    'openai/third-party',
    'gateway/sonnet',
    'custom-claude-sonnet',
    'my-gpt-5',
    'gpt-5/custom',
    'Qwen/Qwen3',
    'deepseek/deepseek-v4'
  ])('leaves an unknown or ambiguous ID neutral: %s', (id) => {
    expect(modelFamilyFromId(id)).toBeNull()
  })
})
