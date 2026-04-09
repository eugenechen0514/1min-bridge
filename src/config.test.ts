import { describe, it, expect } from 'vitest'
import { resolveModelName, getModelList, getApiKey } from './config.js'

describe('resolveModelName', () => {
  it('returns mapped name when alias exists', () => {
    const mapping = { 'my-fast': 'gpt-4o-mini' }
    expect(resolveModelName('my-fast', mapping)).toBe('gpt-4o-mini')
  })

  it('returns original name when no alias', () => {
    const mapping = { 'my-fast': 'gpt-4o-mini' }
    expect(resolveModelName('gpt-4o', mapping)).toBe('gpt-4o')
  })
})

describe('getModelList', () => {
  it('includes default models', () => {
    const list = getModelList({})
    expect(list.some(m => m.id === 'gpt-4o')).toBe(true)
  })

  it('includes alias models', () => {
    const list = getModelList({ 'my-model': 'gpt-4o' })
    expect(list.some(m => m.id === 'my-model')).toBe(true)
  })

  it('deduplicates when alias matches default', () => {
    const list = getModelList({ 'gpt-4o': 'gpt-4o-mini' })
    const gpt4oEntries = list.filter(m => m.id === 'gpt-4o')
    expect(gpt4oEntries).toHaveLength(1)
  })
})

describe('getApiKey', () => {
  it('prefers header over env', () => {
    expect(getApiKey('header-key', 'env-key')).toBe('header-key')
  })

  it('falls back to env when no header', () => {
    expect(getApiKey(undefined, 'env-key')).toBe('env-key')
  })

  it('returns undefined when neither set', () => {
    expect(getApiKey(undefined, undefined)).toBeUndefined()
  })
})
