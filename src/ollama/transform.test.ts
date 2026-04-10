import { describe, it, expect } from 'vitest'
import {
  toOllamaChatResponse,
  toOllamaChatStreamChunk,
  toOllamaGenerateResponse,
  toOllamaGenerateStreamChunk,
} from './transform.js'

describe('toOllamaChatResponse', () => {
  it('wraps content in Ollama chat format', () => {
    const result = toOllamaChatResponse('Hello!', 'gpt-4o')
    expect(result.model).toBe('gpt-4o')
    expect(result.message.role).toBe('assistant')
    expect(result.message.content).toBe('Hello!')
    expect(result.done).toBe(true)
  })
})

describe('toOllamaChatStreamChunk', () => {
  it('wraps content in streaming chunk (not done)', () => {
    const chunk = toOllamaChatStreamChunk('Hi', 'gpt-4o', false)
    expect(chunk.done).toBe(false)
    expect(chunk.message.content).toBe('Hi')
    expect(chunk.model).toBe('gpt-4o')
  })

  it('marks done on final chunk', () => {
    const chunk = toOllamaChatStreamChunk('', 'gpt-4o', true)
    expect(chunk.done).toBe(true)
  })
})

describe('toOllamaGenerateResponse', () => {
  it('wraps content in Ollama generate format', () => {
    const result = toOllamaGenerateResponse('Hello!', 'gpt-4o')
    expect(result.model).toBe('gpt-4o')
    expect(result.response).toBe('Hello!')
    expect(result.done).toBe(true)
  })
})

describe('toOllamaGenerateStreamChunk', () => {
  it('wraps content in generate streaming chunk', () => {
    const chunk = toOllamaGenerateStreamChunk('Hi', 'gpt-4o', false)
    expect(chunk.done).toBe(false)
    expect(chunk.response).toBe('Hi')
  })
})
