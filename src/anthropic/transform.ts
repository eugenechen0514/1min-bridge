import { ROLE_PREFIX } from '../core/types.js'

// ── Anthropic Messages to Prompt ─────────────────────

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

// ── Tool Prompt ──────────────────────────────────────

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

// ── System normalization (private) ───────────────────

function normalizeSystem(system?: string | any[]): string | undefined {
  if (!system) return undefined
  if (typeof system === 'string') return system
  // system can be an array of content blocks: [{type:"text",text:"..."},...]
  return system
    .map((b: any) => (typeof b === 'string' ? b : b.text ?? ''))
    .filter(Boolean)
    .join('\n')
}

// ── Build full Anthropic prompt ──────────────────────

export function toAnthropicPrompt(body: {
  messages: { role: string; content: string | any[] }[]
  system?: string | any[]
  tools?: any[]
}): string {
  const toolPrompt = anthropicToolsToPrompt(body.tools)
  const sys = normalizeSystem(body.system)
  const systemParts = [sys, toolPrompt].filter(Boolean).join('\n\n')
  return anthropicMessagesToPrompt(body.messages, systemParts || undefined)
}

// ── Image extraction ─────────────────────────────────

export type AnthropicImage =
  | { type: 'url'; url: string }
  | { type: 'base64'; media_type: string; data: string }

export function extractAnthropicImages(
  messages: { role: string; content: string | any[] }[],
): AnthropicImage[] {
  const images: AnthropicImage[] = []
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue
    for (const block of msg.content) {
      if (block.type !== 'image') continue
      const src = block.source
      if (src?.type === 'url') {
        images.push({ type: 'url', url: src.url })
      } else if (src?.type === 'base64') {
        images.push({ type: 'base64', media_type: src.media_type, data: src.data })
      }
    }
  }
  return images
}

// ── Document extraction ──────────────────────────────

export interface AnthropicDocument {
  type: 'base64'
  media_type: string
  data: string
}

export function extractAnthropicDocuments(
  messages: { role: string; content: string | any[] }[],
): AnthropicDocument[] {
  const docs: AnthropicDocument[] = []
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue
    for (const block of msg.content) {
      if (block.type !== 'document') continue
      const src = block.source
      if (src?.type === 'base64') {
        docs.push({ type: 'base64', media_type: src.media_type, data: src.data })
      }
    }
  }
  return docs
}

// ── Anthropic Models ─────────────────────────────────

const defaultCap = { supported: false }
const supportedCap = { supported: true }

function anthropicModelInfo(id: string) {
  return {
    id,
    type: 'model' as const,
    display_name: id,
    created_at: '2025-01-01T00:00:00Z',
    max_input_tokens: 200000,
    max_tokens: 8192,
    capabilities: {
      batch: defaultCap,
      citations: defaultCap,
      code_execution: defaultCap,
      context_management: { supported: false, clear_thinking_20251015: defaultCap, clear_tool_uses_20250919: defaultCap, compact_20260112: defaultCap },
      effort: { supported: false, high: defaultCap, low: defaultCap, max: defaultCap, medium: defaultCap },
      image_input: supportedCap,
      pdf_input: defaultCap,
      structured_outputs: defaultCap,
      thinking: { supported: false, types: { adaptive: defaultCap, enabled: defaultCap } },
    },
  }
}

export function toAnthropicModelList(models: { id: string; owned_by: string }[]) {
  const anthropicModels = models.filter(m => m.owned_by === 'anthropic' || m.id.startsWith('claude'))
  const data = anthropicModels.map(m => anthropicModelInfo(m.id))
  return {
    data,
    has_more: false,
    first_id: data[0]?.id ?? null,
    last_id: data[data.length - 1]?.id ?? null,
  }
}

export function toAnthropicModelInfo(modelId: string) {
  return anthropicModelInfo(modelId)
}

// ── Response Parsing ─────────────────────────────────

export function parseAnthropicResponse(text: string): {
  type: 'text' | 'tool_use'
  content: any[]
  stop_reason: string
} {
  const trimmed = text.trim()

  // Find all tool_use JSON objects in the response
  const toolCalls: { index: number; length: number; parsed: any }[] = []
  const toolCallPattern = /\{"type"\s*:\s*"tool_use"/g
  let searchMatch
  while ((searchMatch = toolCallPattern.exec(trimmed)) !== null) {
    // Try to extract a valid JSON object starting at this position
    const startIdx = searchMatch.index
    let braceDepth = 0
    let endIdx = -1
    for (let i = startIdx; i < trimmed.length; i++) {
      if (trimmed[i] === '{') braceDepth++
      else if (trimmed[i] === '}') {
        braceDepth--
        if (braceDepth === 0) { endIdx = i + 1; break }
      }
    }
    if (endIdx > startIdx) {
      try {
        const parsed = JSON.parse(trimmed.slice(startIdx, endIdx))
        if (parsed.type === 'tool_use' && parsed.name && parsed.id) {
          toolCalls.push({ index: startIdx, length: endIdx - startIdx, parsed })
        }
      } catch { /* not valid JSON, skip */ }
    }
  }

  if (toolCalls.length > 0) {
    const content: any[] = []
    // Extract text before the first tool call
    const beforeText = trimmed.slice(0, toolCalls[0].index).trim()
    if (beforeText) {
      content.push({ type: 'text', text: beforeText })
    }
    for (const tc of toolCalls) {
      content.push({
        type: 'tool_use',
        id: tc.parsed.id,
        name: tc.parsed.name,
        input: tc.parsed.input ?? {},
      })
    }
    return { type: 'tool_use', content, stop_reason: 'tool_use' }
  }

  return {
    type: 'text',
    content: [{ type: 'text', text: trimmed }],
    stop_reason: 'end_turn',
  }
}

// ── Anthropic Response ───────────────────────────────

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

// ── Anthropic Streaming Events ───────────────────────

export function anthropicStreamEvents(model: string) {
  const msgId = `msg_${crypto.randomUUID()}`

  return {
    msgId,
    messageStart: () => ({
      event: 'message_start',
      data: {
        type: 'message_start',
        message: {
          id: msgId,
          type: 'message',
          role: 'assistant',
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      },
    }),
    contentBlockStart: (index: number, type: 'text' | 'tool_use', toolUse?: { id: string; name: string }) => ({
      event: 'content_block_start',
      data: {
        type: 'content_block_start',
        index,
        content_block: type === 'text'
          ? { type: 'text', text: '' }
          : { type: 'tool_use', id: toolUse!.id, name: toolUse!.name, input: {} },
      },
    }),
    textDelta: (index: number, text: string) => ({
      event: 'content_block_delta',
      data: {
        type: 'content_block_delta',
        index,
        delta: { type: 'text_delta', text },
      },
    }),
    inputJsonDelta: (index: number, partial_json: string) => ({
      event: 'content_block_delta',
      data: {
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json },
      },
    }),
    contentBlockStop: (index: number) => ({
      event: 'content_block_stop',
      data: { type: 'content_block_stop', index },
    }),
    messageDelta: (stop_reason: string) => ({
      event: 'message_delta',
      data: {
        type: 'message_delta',
        delta: { stop_reason, stop_sequence: null },
        usage: { output_tokens: 0 },
      },
    }),
    messageStop: () => ({
      event: 'message_stop',
      data: { type: 'message_stop' },
    }),
    ping: () => ({
      event: 'ping',
      data: { type: 'ping' },
    }),
  }
}
