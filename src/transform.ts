// Pure transform functions — no I/O, no side effects

// ── Types ──────────────────────────────────────────────

interface TextContentPart {
  type: 'text'
  text: string
}

interface ImageUrlContentPart {
  type: 'image_url'
  image_url: { url: string }
}

type ContentPart = TextContentPart | ImageUrlContentPart

interface Message {
  role: string
  content: string | ContentPart[]
}

interface OneMinAiRequestInput {
  model: string
  prompt: string
  images: string[]
  webSearch: boolean
}

// ── Helpers ────────────────────────────────────────────

function contentToText(content: string | ContentPart[]): string {
  if (typeof content === 'string') return content
  return content
    .filter((p): p is TextContentPart => p.type === 'text')
    .map((p) => p.text)
    .join('\n')
}

const ROLE_PREFIX: Record<string, string> = {
  system: '[System]',
  user: '[User]',
  assistant: '[Assistant]',
}

// ── Exports ────────────────────────────────────────────

export function messagesToPrompt(messages: Message[]): string {
  // Single user message with string content → return as-is (no prefix)
  if (
    messages.length === 1 &&
    messages[0].role === 'user' &&
    typeof messages[0].content === 'string'
  ) {
    return messages[0].content
  }

  // Single user message with array content → extract text, no prefix
  if (messages.length === 1 && messages[0].role === 'user') {
    return contentToText(messages[0].content)
  }

  // Multi-turn → prefix each message
  return messages
    .map((m) => {
      const prefix = ROLE_PREFIX[m.role] ?? `[${m.role}]`
      return `${prefix} ${contentToText(m.content)}`
    })
    .join('\n')
}

export function anthropicMessagesToPrompt(
  messages: { role: string; content: string | any[] }[],
  system?: string,
): string {
  const blocksToText = (content: string | any[]): string => {
    if (typeof content === 'string') return content
    return content
      .map((b: any) => {
        if (b.type === 'text') return b.text
        if (b.type === 'tool_use')
          return `[Tool call: ${b.name}] ${JSON.stringify(b.input, null, 2)}`
        if (b.type === 'tool_result')
          return `[Tool result for ${b.tool_use_id}] ${typeof b.content === 'string' ? b.content : JSON.stringify(b.content)}`
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }

  // Single user message, no system → no prefix
  if (!system && messages.length === 1 && messages[0].role === 'user') {
    return blocksToText(messages[0].content)
  }

  const parts: string[] = []
  if (system) parts.push(`[System] ${system}`)
  for (const m of messages) {
    const prefix = ROLE_PREFIX[m.role] ?? `[${m.role}]`
    parts.push(`${prefix} ${blocksToText(m.content)}`)
  }
  return parts.join('\n')
}

export function anthropicToolsToPrompt(tools?: any[]): string {
  if (!tools || tools.length === 0) return ''

  const toolDefs = tools.map((t) =>
    `- ${t.name}: ${t.description}\n  Input schema: ${JSON.stringify(t.input_schema)}`
  ).join('\n')

  return [
    'You have access to the following tools. When you want to use a tool, respond ONLY with a single JSON object in this exact format (no other text before or after):',
    '{"type":"tool_use","id":"toolu_UNIQUE_ID","name":"TOOL_NAME","input":{...}}',
    '',
    'Available tools:',
    toolDefs,
    '',
    'Rules:',
    '- If you need to use a tool, output ONLY the JSON tool call, nothing else.',
    '- If you want to respond with text (no tool needed), just respond normally with text.',
    '- For the "id" field, generate a unique ID starting with "toolu_".',
  ].join('\n')
}

export function toAnthropicPrompt(body: {
  messages: { role: string; content: string | any[] }[]
  system?: string
  tools?: any[]
}): string {
  const toolPrompt = anthropicToolsToPrompt(body.tools)
  const systemParts = [body.system, toolPrompt].filter(Boolean).join('\n\n')
  return anthropicMessagesToPrompt(body.messages, systemParts || undefined)
}

export function extractImages(messages: Message[]): string[] {
  const urls: string[] = []
  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'image_url') {
          urls.push(part.image_url.url)
        }
      }
    }
  }
  return urls
}

export function extractWebSearch(webSearchOptions: unknown): boolean {
  return webSearchOptions != null
}

export function toOneMinAiRequest({ model, prompt, images, webSearch }: OneMinAiRequestInput) {
  const promptObject: {
    prompt: string
    attachments?: { images: string[] }
    settings?: { webSearchSettings: { webSearch: boolean } }
  } = { prompt }

  if (images.length > 0) {
    promptObject.attachments = { images }
  }

  if (webSearch) {
    promptObject.settings = { webSearchSettings: { webSearch: true } }
  }

  return {
    type: 'UNIFY_CHAT_WITH_AI' as const,
    model,
    promptObject,
  }
}

export function fromOneMinAiResponse(data: {
  aiRecord: { aiRecordDetail: { resultObject: string[] } }
}): string {
  return data.aiRecord.aiRecordDetail.resultObject[0]
}

export function toOpenAiResponse(content: string, model: string) {
  return {
    id: `chatcmpl-${crypto.randomUUID()}`,
    object: 'chat.completion' as const,
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant' as const, content },
        finish_reason: 'stop' as const,
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  }
}

export function toOpenAiStreamChunk(content: string, model: string) {
  return {
    id: `chatcmpl-${crypto.randomUUID()}`,
    object: 'chat.completion.chunk' as const,
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: { content },
        finish_reason: null,
      },
    ],
  }
}

export function toOllamaChatResponse(content: string, model: string) {
  return {
    model,
    created_at: new Date().toISOString(),
    message: { role: 'assistant' as const, content },
    done: true as const,
  }
}

export function toOllamaChatStreamChunk(content: string, model: string, done: boolean) {
  return {
    model,
    created_at: new Date().toISOString(),
    message: { role: 'assistant' as const, content },
    done,
  }
}

export function toOllamaGenerateResponse(content: string, model: string) {
  return {
    model,
    created_at: new Date().toISOString(),
    response: content,
    done: true as const,
  }
}

export function toOllamaGenerateStreamChunk(content: string, model: string, done: boolean) {
  return {
    model,
    created_at: new Date().toISOString(),
    response: content,
    done,
  }
}

// ── Anthropic Response Parsing ─────────────────────────

export function parseAnthropicResponse(text: string): {
  type: 'text' | 'tool_use'
  content: any[]
  stop_reason: string
} {
  const trimmed = text.trim()

  // Try to find a tool_use JSON in the response
  const toolCallRegex = /\{"type"\s*:\s*"tool_use"[\s\S]*\}$/
  const match = trimmed.match(toolCallRegex)

  if (match) {
    try {
      const parsed = JSON.parse(match[0])
      if (parsed.type === 'tool_use' && parsed.name && parsed.id) {
        const content: any[] = []
        const beforeText = trimmed.slice(0, match.index).trim()
        if (beforeText) {
          content.push({ type: 'text', text: beforeText })
        }
        content.push({
          type: 'tool_use',
          id: parsed.id,
          name: parsed.name,
          input: parsed.input ?? {},
        })
        return { type: 'tool_use', content, stop_reason: 'tool_use' }
      }
    } catch {
      // Not valid JSON, treat as text
    }
  }

  return {
    type: 'text',
    content: [{ type: 'text', text: trimmed }],
    stop_reason: 'end_turn',
  }
}

export function toAnthropicResponse(rawText: string, model: string) {
  const parsed = parseAnthropicResponse(rawText)
  return {
    id: `msg_${crypto.randomUUID()}`,
    type: 'message' as const,
    role: 'assistant' as const,
    model,
    content: parsed.content,
    stop_reason: parsed.stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  }
}

// ── Responses API ─────────────────────────────────────

/**
 * Convert Responses API `input` field to a prompt string.
 * input can be: string | InputItem[]
 * InputItem: { type: 'message', role, content: string | ContentPart[] }
 *          | { type: 'function_call_output', call_id, output }
 */
export function responsesInputToPrompt(
  input: string | any[],
  instructions?: string,
): string {
  let prompt: string

  if (typeof input === 'string') {
    prompt = input
  } else {
    // Convert InputItem[] to messages format, then reuse messagesToPrompt
    const messages: Message[] = input
      .filter((item) => item.type === 'message')
      .map((item) => ({ role: item.role, content: item.content }))
    prompt = messages.length > 0 ? messagesToPrompt(messages) : ''
  }

  if (instructions) {
    return `[System] ${instructions}\n[User] ${prompt}`
  }
  return prompt
}

export function responsesExtractImages(input: string | any[]): string[] {
  if (typeof input === 'string') return []
  const messages: Message[] = input
    .filter((item) => item.type === 'message')
    .map((item) => ({ role: item.role, content: item.content }))
  return extractImages(messages)
}

export function toResponsesApiResponse(content: string, model: string) {
  const respId = `resp_${crypto.randomUUID()}`
  const msgId = `msg_${crypto.randomUUID()}`
  return {
    id: respId,
    object: 'response' as const,
    created_at: Math.floor(Date.now() / 1000),
    status: 'completed' as const,
    model,
    output: [
      {
        type: 'message' as const,
        id: msgId,
        role: 'assistant' as const,
        status: 'completed' as const,
        content: [{ type: 'output_text' as const, text: content }],
      },
    ],
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    error: null,
  }
}

/**
 * Generate the sequence of SSE events for Responses API streaming.
 * Returns an array of { event, data } pairs to emit in order.
 */
export function responsesStreamEvents(model: string) {
  const respId = `resp_${crypto.randomUUID()}`
  const msgId = `msg_${crypto.randomUUID()}`
  const ts = Math.floor(Date.now() / 1000)

  const base = { id: respId, object: 'response' as const, created_at: ts, model }

  return {
    respId,
    msgId,
    created: () => ({
      event: 'response.created',
      data: { ...base, status: 'in_progress', output: [], usage: null, error: null },
    }),
    outputItemAdded: () => ({
      event: 'response.output_item.added',
      data: {
        output_index: 0,
        item: {
          type: 'message', id: msgId, role: 'assistant', status: 'in_progress',
          content: [],
        },
      },
    }),
    contentPartAdded: () => ({
      event: 'response.content_part.added',
      data: {
        output_index: 0,
        content_index: 0,
        part: { type: 'output_text', text: '' },
      },
    }),
    textDelta: (delta: string) => ({
      event: 'response.output_text.delta',
      data: { output_index: 0, content_index: 0, delta },
    }),
    textDone: (text: string) => ({
      event: 'response.output_text.done',
      data: { output_index: 0, content_index: 0, text },
    }),
    contentPartDone: (text: string) => ({
      event: 'response.content_part.done',
      data: { output_index: 0, content_index: 0, part: { type: 'output_text', text } },
    }),
    outputItemDone: (text: string) => ({
      event: 'response.output_item.done',
      data: {
        output_index: 0,
        item: {
          type: 'message', id: msgId, role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text }],
        },
      },
    }),
    completed: (text: string) => ({
      event: 'response.completed',
      data: {
        ...base,
        status: 'completed',
        output: [{
          type: 'message', id: msgId, role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text }],
        }],
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        error: null,
      },
    }),
  }
}
