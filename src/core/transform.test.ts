import { describe, it, expect } from 'vitest'
import {
  messagesToPrompt,
  extractImages,
  extractWebSearch,
  toOneMinAiRequest,
  fromOneMinAiResponse,
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
        { type: 'text' as const, text: 'What is this?' },
        { type: 'image_url' as const, image_url: { url: 'https://example.com/img.png' } },
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
        { type: 'text' as const, text: 'What is this?' },
        { type: 'image_url' as const, image_url: { url: 'https://example.com/img.png' } },
      ],
    }]
    expect(extractImages(messages)).toEqual(['https://example.com/img.png'])
  })

  it('extracts multiple images from multiple messages', () => {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'image_url' as const, image_url: { url: 'https://example.com/1.png' } },
          { type: 'image_url' as const, image_url: { url: 'https://example.com/2.png' } },
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
      files: [],
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
      files: [],
      webSearch: false,
    })
    expect(result.promptObject.attachments).toEqual({
      images: ['https://example.com/img.png'],
    })
  })

  it('includes attachments when files present', () => {
    const result = toOneMinAiRequest({
      model: 'gpt-4o',
      prompt: 'Summarize',
      images: [],
      files: ['20ad0277-74df-4629-8c50-56a2549acbd7'],
      webSearch: false,
    })
    expect(result.promptObject.attachments).toEqual({
      files: ['20ad0277-74df-4629-8c50-56a2549acbd7'],
    })
  })

  it('includes both images and files in attachments', () => {
    const result = toOneMinAiRequest({
      model: 'gpt-4o',
      prompt: 'Describe',
      images: ['https://example.com/img.png'],
      files: ['some-uuid'],
      webSearch: false,
    })
    expect(result.promptObject.attachments).toEqual({
      images: ['https://example.com/img.png'],
      files: ['some-uuid'],
    })
  })

  it('includes webSearchSettings when webSearch is true', () => {
    const result = toOneMinAiRequest({
      model: 'gpt-4o',
      prompt: 'Latest news',
      images: [],
      files: [],
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
