import type { ContentPart, TextContentPart, Message, OneMinAiRequestInput } from './types.js'
import { ROLE_PREFIX } from './types.js'

function contentToText(content: string | ContentPart[]): string {
  if (typeof content === 'string') return content
  return content
    .filter((p): p is TextContentPart => p.type === 'text')
    .map((p) => p.text)
    .join('\n')
}

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

export function toOneMinAiRequest({ model, prompt, images, files, webSearch }: OneMinAiRequestInput) {
  const promptObject: {
    prompt: string
    attachments?: { images?: string[]; files?: string[] }
    settings?: { webSearchSettings: { webSearch: boolean } }
  } = { prompt }

  if (images.length > 0 || files.length > 0) {
    promptObject.attachments = {}
    if (images.length > 0) promptObject.attachments.images = images
    if (files.length > 0) promptObject.attachments.files = files
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
