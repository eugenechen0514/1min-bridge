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
  responsesInputToPrompt,
  responsesExtractImages,
  toResponsesApiResponse,
  responsesStreamEvents,
  anthropicMessagesToPrompt,
  anthropicToolsToPrompt,
  toAnthropicPrompt,
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

// ── Anthropic Messages API ───────────────────────────

describe('anthropicMessagesToPrompt', () => {
  it('converts single user message', () => {
    const messages = [{ role: 'user', content: 'Hello' }]
    expect(anthropicMessagesToPrompt(messages)).toBe('Hello')
  })

  it('converts content array with text block', () => {
    const messages = [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }]
    expect(anthropicMessagesToPrompt(messages)).toBe('Hello')
  })

  it('converts multi-turn conversation', () => {
    const messages = [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello!' },
      { role: 'user', content: 'How are you?' },
    ]
    expect(anthropicMessagesToPrompt(messages)).toBe(
      '[User] Hi\n[Assistant] Hello!\n[User] How are you?'
    )
  })

  it('prepends system message', () => {
    const messages = [{ role: 'user', content: 'Hi' }]
    expect(anthropicMessagesToPrompt(messages, 'Be helpful')).toBe(
      '[System] Be helpful\n[User] Hi'
    )
  })

  it('serializes tool_use block in assistant message', () => {
    const messages = [
      { role: 'user', content: 'List files' },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'toolu_1', name: 'bash', input: { command: 'ls' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: 'file1.txt\nfile2.txt' },
        ],
      },
      { role: 'user', content: 'What files are there?' },
    ]
    const result = anthropicMessagesToPrompt(messages)
    expect(result).toContain('[Assistant] [Tool call: bash]')
    expect(result).toContain('"command": "ls"')
    expect(result).toContain('[Tool result for toolu_1]')
    expect(result).toContain('file1.txt')
  })

  it('serializes mixed text and tool_use in assistant message', () => {
    const messages = [
      { role: 'user', content: 'Hi' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me check.' },
          { type: 'tool_use', id: 'toolu_2', name: 'read_file', input: { path: '/tmp/x' } },
        ],
      },
    ]
    const result = anthropicMessagesToPrompt(messages)
    expect(result).toContain('Let me check.')
    expect(result).toContain('[Tool call: read_file]')
  })
})

describe('anthropicToolsToPrompt', () => {
  it('returns empty string when no tools', () => {
    expect(anthropicToolsToPrompt([])).toBe('')
    expect(anthropicToolsToPrompt(undefined)).toBe('')
  })

  it('formats tool definitions with instructions', () => {
    const tools = [{
      name: 'get_weather',
      description: 'Get weather for a location',
      input_schema: {
        type: 'object',
        properties: { location: { type: 'string' } },
        required: ['location'],
      },
    }]
    const result = anthropicToolsToPrompt(tools)
    expect(result).toContain('get_weather')
    expect(result).toContain('Get weather for a location')
    expect(result).toContain('"location"')
    expect(result).toContain('tool_use')
  })
})

describe('toAnthropicPrompt', () => {
  it('builds prompt without tools or system', () => {
    const result = toAnthropicPrompt({
      messages: [{ role: 'user', content: 'Hello' }],
    })
    expect(result).toBe('Hello')
  })

  it('builds prompt with system and tools', () => {
    const result = toAnthropicPrompt({
      system: 'Be helpful',
      tools: [{ name: 'bash', description: 'Run bash', input_schema: { type: 'object', properties: { command: { type: 'string' } } } }],
      messages: [{ role: 'user', content: 'List files' }],
    })
    expect(result).toContain('[System] Be helpful')
    expect(result).toContain('bash')
    expect(result).toContain('[User] List files')
  })
})
