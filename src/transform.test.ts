import { describe, it, expect } from 'vitest'
import {
  messagesToPrompt,
  extractImages,
  extractWebSearch,
  toOneMinAiRequest,
  fromOneMinAiResponse,
  toOpenAiResponse,
  toOpenAiStreamChunk,
  toOllamaChatResponse,
  toOllamaChatStreamChunk,
  toOllamaGenerateResponse,
  toOllamaGenerateStreamChunk,
} from './transform.js'

describe('messagesToPrompt', () => {
  it('converts single user message without prefix', () => {
    const messages = [{ role: 'user', content: 'Hello' }]
    expect(messagesToPrompt(messages)).toBe('Hello')
  })

  it('converts multi-turn with system using role prefixes', () => {
    const messages = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello!' },
      { role: 'user', content: 'How are you?' },
    ]
    expect(messagesToPrompt(messages)).toBe(
      '[System] You are helpful.\n[User] Hi\n[Assistant] Hello!\n[User] How are you?'
    )
  })

  it('handles content array (extracts text parts)', () => {
    const messages = [{
      role: 'user',
      content: [
        { type: 'text', text: 'What is this?' },
        { type: 'image_url', image_url: { url: 'https://example.com/img.png' } },
      ],
    }]
    expect(messagesToPrompt(messages)).toBe('What is this?')
  })
})

describe('extractImages', () => {
  it('returns empty array when no images', () => {
    const messages = [{ role: 'user', content: 'Hello' }]
    expect(extractImages(messages)).toEqual([])
  })

  it('extracts image URLs from content array', () => {
    const messages = [{
      role: 'user',
      content: [
        { type: 'text', text: 'What is this?' },
        { type: 'image_url', image_url: { url: 'https://example.com/img.png' } },
      ],
    }]
    expect(extractImages(messages)).toEqual(['https://example.com/img.png'])
  })

  it('extracts multiple images from multiple messages', () => {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: 'https://example.com/1.png' } },
          { type: 'image_url', image_url: { url: 'https://example.com/2.png' } },
        ],
      },
    ]
    expect(extractImages(messages)).toEqual([
      'https://example.com/1.png',
      'https://example.com/2.png',
    ])
  })
})

describe('extractWebSearch', () => {
  it('returns false when undefined', () => {
    expect(extractWebSearch(undefined)).toBe(false)
  })

  it('returns true when object is set', () => {
    expect(extractWebSearch({})).toBe(true)
  })
})

describe('toOneMinAiRequest', () => {
  it('builds basic request', () => {
    const result = toOneMinAiRequest({
      model: 'gpt-4o',
      prompt: 'Hello',
      images: [],
      webSearch: false,
    })
    expect(result).toEqual({
      type: 'UNIFY_CHAT_WITH_AI',
      model: 'gpt-4o',
      promptObject: {
        prompt: 'Hello',
      },
    })
  })

  it('includes attachments when images present', () => {
    const result = toOneMinAiRequest({
      model: 'gpt-4o',
      prompt: 'Describe',
      images: ['https://example.com/img.png'],
      webSearch: false,
    })
    expect(result.promptObject.attachments).toEqual({
      images: ['https://example.com/img.png'],
    })
  })

  it('includes webSearchSettings when webSearch is true', () => {
    const result = toOneMinAiRequest({
      model: 'gpt-4o',
      prompt: 'Latest news',
      images: [],
      webSearch: true,
    })
    expect(result.promptObject.settings).toEqual({
      webSearchSettings: { webSearch: true },
    })
  })
})

describe('fromOneMinAiResponse', () => {
  it('extracts content from 1min.ai response', () => {
    const data = {
      aiRecord: {
        aiRecordDetail: {
          resultObject: ['Hello from AI'],
        },
      },
    }
    expect(fromOneMinAiResponse(data)).toBe('Hello from AI')
  })
})

describe('toOpenAiResponse', () => {
  it('wraps content in OpenAI chat completion format', () => {
    const result = toOpenAiResponse('Hello!', 'gpt-4o')
    expect(result.object).toBe('chat.completion')
    expect(result.choices[0].message.content).toBe('Hello!')
    expect(result.choices[0].message.role).toBe('assistant')
    expect(result.choices[0].finish_reason).toBe('stop')
    expect(result.choices[0].index).toBe(0)
    expect(result.model).toBe('gpt-4o')
    expect(result.id).toMatch(/^chatcmpl-/)
    expect(result.usage).toBeDefined()
  })
})

describe('toOpenAiStreamChunk', () => {
  it('wraps content in SSE chunk format', () => {
    const chunk = toOpenAiStreamChunk('Hi', 'gpt-4o')
    expect(chunk.object).toBe('chat.completion.chunk')
    expect(chunk.choices[0].delta.content).toBe('Hi')
    expect(chunk.choices[0].index).toBe(0)
    expect(chunk.model).toBe('gpt-4o')
    expect(chunk.id).toMatch(/^chatcmpl-/)
  })
})

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
