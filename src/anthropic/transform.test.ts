import { describe, it, expect } from 'vitest'
import {
  extractAnthropicImages,
  extractAnthropicDocuments,
  anthropicMessagesToPrompt,
  anthropicToolsToPrompt,
  toAnthropicPrompt,
  parseAnthropicResponse,
  toAnthropicResponse,
  anthropicStreamEvents,
} from './transform.js'

// ── Anthropic Messages API ───────────────────────────

describe('extractAnthropicImages', () => {
  it('returns empty array for string content', () => {
    const messages = [{ role: 'user', content: 'Hello' }]
    expect(extractAnthropicImages(messages)).toEqual([])
  })

  it('extracts URL-based images', () => {
    const messages = [{
      role: 'user',
      content: [
        { type: 'text', text: 'What is this?' },
        { type: 'image', source: { type: 'url', url: 'https://example.com/img.png' } },
      ],
    }]
    expect(extractAnthropicImages(messages)).toEqual([
      { type: 'url', url: 'https://example.com/img.png' },
    ])
  })

  it('extracts base64 images with media type', () => {
    const messages = [{
      role: 'user',
      content: [
        { type: 'text', text: 'Describe' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBOR' } },
      ],
    }]
    expect(extractAnthropicImages(messages)).toEqual([
      { type: 'base64', media_type: 'image/png', data: 'iVBOR' },
    ])
  })

  it('extracts multiple images from multiple messages', () => {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'url', url: 'https://example.com/1.png' } },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'abc123' } },
        ],
      },
    ]
    expect(extractAnthropicImages(messages)).toEqual([
      { type: 'url', url: 'https://example.com/1.png' },
      { type: 'base64', media_type: 'image/jpeg', data: 'abc123' },
    ])
  })
})

describe('extractAnthropicDocuments', () => {
  it('returns empty array for string content', () => {
    const messages = [{ role: 'user', content: 'Hello' }]
    expect(extractAnthropicDocuments(messages)).toEqual([])
  })

  it('extracts base64 PDF document', () => {
    const messages = [{
      role: 'user',
      content: [
        { type: 'text', text: 'Summarize this' },
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0x' } },
      ],
    }]
    expect(extractAnthropicDocuments(messages)).toEqual([
      { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0x' },
    ])
  })

  it('ignores non-document blocks', () => {
    const messages = [{
      role: 'user',
      content: [
        { type: 'text', text: 'Hello' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBOR' } },
      ],
    }]
    expect(extractAnthropicDocuments(messages)).toEqual([])
  })
})

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

  it('handles system as array of content blocks', () => {
    const result = toAnthropicPrompt({
      system: [
        { type: 'text', text: 'You are helpful.' },
        { type: 'text', text: 'Be concise.' },
      ],
      messages: [{ role: 'user', content: 'Hello' }],
    })
    expect(result).toContain('[System] You are helpful.\nBe concise.')
    expect(result).toContain('[User] Hello')
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

describe('parseAnthropicResponse', () => {
  it('returns text content block for plain text', () => {
    const result = parseAnthropicResponse('Hello world')
    expect(result).toEqual({
      type: 'text',
      content: [{ type: 'text', text: 'Hello world' }],
      stop_reason: 'end_turn',
    })
  })

  it('returns tool_use content block for tool call JSON', () => {
    const json = '{"type":"tool_use","id":"toolu_123","name":"bash","input":{"command":"ls"}}'
    const result = parseAnthropicResponse(json)
    expect(result).toEqual({
      type: 'tool_use',
      content: [{ type: 'tool_use', id: 'toolu_123', name: 'bash', input: { command: 'ls' } }],
      stop_reason: 'tool_use',
    })
  })

  it('handles tool call JSON with surrounding whitespace', () => {
    const json = '  \n{"type":"tool_use","id":"toolu_456","name":"read","input":{"path":"/tmp"}}\n  '
    const result = parseAnthropicResponse(json)
    expect(result.type).toBe('tool_use')
    expect(result.content[0].name).toBe('read')
  })

  it('treats non-tool JSON as text', () => {
    const result = parseAnthropicResponse('{"key": "value"}')
    expect(result.type).toBe('text')
  })

  it('handles text before tool call JSON (text + tool_use)', () => {
    const text = 'Let me check that.\n{"type":"tool_use","id":"toolu_789","name":"bash","input":{"command":"ls"}}'
    const result = parseAnthropicResponse(text)
    expect(result.type).toBe('tool_use')
    expect(result.content).toHaveLength(2)
    expect(result.content[0]).toEqual({ type: 'text', text: 'Let me check that.' })
    expect(result.content[1].type).toBe('tool_use')
  })

  it('handles multiple tool calls', () => {
    const text = 'I will read two files.\n{"type":"tool_use","id":"toolu_01","name":"Read","input":{"file_path":"/tmp/a.txt"}}\n{"type":"tool_use","id":"toolu_02","name":"Read","input":{"file_path":"/tmp/b.txt"}}'
    const result = parseAnthropicResponse(text)
    expect(result.type).toBe('tool_use')
    expect(result.content).toHaveLength(3)
    expect(result.content[0]).toEqual({ type: 'text', text: 'I will read two files.' })
    expect(result.content[1]).toEqual({ type: 'tool_use', id: 'toolu_01', name: 'Read', input: { file_path: '/tmp/a.txt' } })
    expect(result.content[2]).toEqual({ type: 'tool_use', id: 'toolu_02', name: 'Read', input: { file_path: '/tmp/b.txt' } })
    expect(result.stop_reason).toBe('tool_use')
  })

  it('handles multiple tool calls without preceding text', () => {
    const text = '{"type":"tool_use","id":"toolu_01","name":"bash","input":{"command":"ls"}}\n{"type":"tool_use","id":"toolu_02","name":"bash","input":{"command":"pwd"}}'
    const result = parseAnthropicResponse(text)
    expect(result.type).toBe('tool_use')
    expect(result.content).toHaveLength(2)
    expect(result.content[0].name).toBe('bash')
    expect(result.content[1].name).toBe('bash')
  })
})

describe('toAnthropicResponse', () => {
  it('builds text response', () => {
    const result = toAnthropicResponse('Hello!', 'claude-sonnet-4-20250514')
    expect(result.id).toMatch(/^msg_/)
    expect(result.type).toBe('message')
    expect(result.role).toBe('assistant')
    expect(result.model).toBe('claude-sonnet-4-20250514')
    expect(result.content).toEqual([{ type: 'text', text: 'Hello!' }])
    expect(result.stop_reason).toBe('end_turn')
    expect(result.usage).toBeDefined()
  })

  it('builds tool_use response', () => {
    const toolJson = '{"type":"tool_use","id":"toolu_1","name":"bash","input":{"command":"ls"}}'
    const result = toAnthropicResponse(toolJson, 'claude-sonnet-4-20250514')
    expect(result.stop_reason).toBe('tool_use')
    expect(result.content[0].type).toBe('tool_use')
    expect(result.content[0].name).toBe('bash')
  })
})

describe('anthropicStreamEvents', () => {
  it('generates message_start event', () => {
    const events = anthropicStreamEvents('claude-sonnet-4-20250514')
    const start = events.messageStart()
    expect(start.event).toBe('message_start')
    expect(start.data.message.model).toBe('claude-sonnet-4-20250514')
    expect(start.data.message.role).toBe('assistant')
  })

  it('generates content_block_start for text', () => {
    const events = anthropicStreamEvents('claude-sonnet-4-20250514')
    const block = events.contentBlockStart(0, 'text')
    expect(block.event).toBe('content_block_start')
    expect(block.data.content_block.type).toBe('text')
  })

  it('generates text delta', () => {
    const events = anthropicStreamEvents('claude-sonnet-4-20250514')
    const delta = events.textDelta(0, 'Hello')
    expect(delta.event).toBe('content_block_delta')
    expect(delta.data.delta.text).toBe('Hello')
  })

  it('generates message_delta with stop_reason', () => {
    const events = anthropicStreamEvents('claude-sonnet-4-20250514')
    const delta = events.messageDelta('end_turn')
    expect(delta.event).toBe('message_delta')
    expect(delta.data.delta.stop_reason).toBe('end_turn')
  })

  it('generates message_stop', () => {
    const events = anthropicStreamEvents('claude-sonnet-4-20250514')
    const stop = events.messageStop()
    expect(stop.event).toBe('message_stop')
  })
})
