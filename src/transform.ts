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
