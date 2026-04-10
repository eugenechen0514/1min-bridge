import type { Message } from '../core/types.js'
import { messagesToPrompt, extractImages } from '../core/transform.js'

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
