import { describe, it, expect } from 'vitest'
import {
  toOpenAiResponse,
  toOpenAiStreamChunk,
  responsesInputToPrompt,
  responsesExtractImages,
  toResponsesApiResponse,
  responsesStreamEvents,
} from './transform.js'

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

// ── Responses API ─────────────────────────────────────

describe('responsesInputToPrompt', () => {
  it('handles string input', () => {
    expect(responsesInputToPrompt('Hello')).toBe('Hello')
  })

  it('handles string input with instructions', () => {
    expect(responsesInputToPrompt('Hello', 'Be helpful')).toBe('[System] Be helpful\n[User] Hello')
  })

  it('handles InputItem array', () => {
    const input = [
      { type: 'message', role: 'user', content: 'Hi' },
      { type: 'message', role: 'assistant', content: 'Hello!' },
      { type: 'message', role: 'user', content: 'How are you?' },
    ]
    expect(responsesInputToPrompt(input)).toBe('[User] Hi\n[Assistant] Hello!\n[User] How are you?')
  })

  it('ignores non-message items like function_call_output', () => {
    const input = [
      { type: 'message', role: 'user', content: 'What weather?' },
      { type: 'function_call_output', call_id: 'c1', output: '25C' },
      { type: 'message', role: 'user', content: 'Thanks' },
    ]
    expect(responsesInputToPrompt(input)).toBe('[User] What weather?\n[User] Thanks')
  })
})

describe('responsesExtractImages', () => {
  it('returns empty for string input', () => {
    expect(responsesExtractImages('Hello')).toEqual([])
  })

  it('extracts images from InputItem array', () => {
    const input = [{
      type: 'message',
      role: 'user',
      content: [
        { type: 'text', text: 'What is this?' },
        { type: 'image_url', image_url: { url: 'https://example.com/img.png' } },
      ],
    }]
    expect(responsesExtractImages(input)).toEqual(['https://example.com/img.png'])
  })
})

describe('toResponsesApiResponse', () => {
  it('wraps content in Responses API format', () => {
    const result = toResponsesApiResponse('Hello!', 'gpt-4o')
    expect(result.object).toBe('response')
    expect(result.status).toBe('completed')
    expect(result.model).toBe('gpt-4o')
    expect(result.id).toMatch(/^resp_/)
    expect(result.output).toHaveLength(1)
    expect(result.output[0].type).toBe('message')
    expect(result.output[0].role).toBe('assistant')
    expect(result.output[0].content[0].type).toBe('output_text')
    expect(result.output[0].content[0].text).toBe('Hello!')
    expect(result.error).toBeNull()
  })
})

describe('responsesStreamEvents', () => {
  it('generates correct event sequence', () => {
    const events = responsesStreamEvents('gpt-4o')
    expect(events.respId).toMatch(/^resp_/)
    expect(events.msgId).toMatch(/^msg_/)

    const created = events.created()
    expect(created.event).toBe('response.created')
    expect(created.data.status).toBe('in_progress')

    const delta = events.textDelta('Hi')
    expect(delta.event).toBe('response.output_text.delta')
    expect(delta.data.delta).toBe('Hi')

    const completed = events.completed('Hello world')
    expect(completed.event).toBe('response.completed')
    expect(completed.data.status).toBe('completed')
    expect(completed.data.output[0].content[0].text).toBe('Hello world')
  })
})
