# Anthropic Messages API Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `/anthropic/v1/messages` endpoint so Claude Code CLI can use 1min.ai as its backend via `ANTHROPIC_BASE_URL`.

**Architecture:** Since 1min.ai doesn't natively support tool calling, we embed tool definitions into the prompt text and parse the model's text response to detect tool call JSON. Messages (including `tool_use`/`tool_result` blocks) are serialized into a prefixed text format. The response is parsed to determine if it's a tool call or plain text, then converted back to Anthropic Messages API format.

**Tech Stack:** Hono (existing), vitest (existing), no new dependencies.

---

## Background

- 1min.ai API only accepts a single `prompt` string and returns plain text in `resultObject[0]`.
- Tested: putting `tools` in `promptObject` or top-level — 1min.ai does NOT forward them to the model.
- Tested: embedding tool definitions in prompt text — **Claude responds with parseable JSON tool calls**. This is the approach we use.
- Anthropic streaming uses SSE with events: `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop`.

## Key Files

- `src/transform.ts` — All new Anthropic transform functions go here (pure functions, no I/O)
- `src/transform.test.ts` — Tests for the transform functions
- `src/index.ts` — New route: `POST /anthropic/v1/messages`

---

### Task 1: Anthropic messages-to-prompt conversion

Convert Anthropic `messages[]` with `system` to a single prompt string. Must handle:
- `system` as top-level string (not in messages)
- Regular text messages: `{role, content: [{type: "text", text: "..."}]}`
- Content as plain string: `{role, content: "hello"}`

**Files:**
- Modify: `src/transform.ts` — add `anthropicMessagesToPrompt()`
- Modify: `src/transform.test.ts` — add tests

**Step 1: Write the failing tests**

Add to `src/transform.test.ts`:

```typescript
import {
  // ... existing imports ...
  anthropicMessagesToPrompt,
} from './transform.js'

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
})
```

**Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — `anthropicMessagesToPrompt` is not exported

**Step 3: Write minimal implementation**

Add to `src/transform.ts`:

```typescript
export function anthropicMessagesToPrompt(
  messages: { role: string; content: string | any[] }[],
  system?: string,
): string {
  const textFromContent = (content: string | any[]): string => {
    if (typeof content === 'string') return content
    return content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n')
  }

  // Single user message, no system → no prefix
  if (!system && messages.length === 1 && messages[0].role === 'user') {
    return textFromContent(messages[0].content)
  }

  const parts: string[] = []
  if (system) parts.push(`[System] ${system}`)
  for (const m of messages) {
    const prefix = ROLE_PREFIX[m.role] ?? `[${m.role}]`
    parts.push(`${prefix} ${textFromContent(m.content)}`)
  }
  return parts.join('\n')
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/transform.ts src/transform.test.ts
git commit -m "feat: add anthropicMessagesToPrompt"
```

---

### Task 2: Tool use messages serialization

Handle Anthropic messages that contain `tool_use` and `tool_result` content blocks. These appear in multi-turn tool calling conversations:

- Assistant message with `tool_use`: `{type: "tool_use", id: "toolu_xxx", name: "bash", input: {command: "ls"}}`
- User message with `tool_result`: `{type: "tool_result", tool_use_id: "toolu_xxx", content: "file1.txt\nfile2.txt"}`

**Files:**
- Modify: `src/transform.ts` — update `anthropicMessagesToPrompt()`
- Modify: `src/transform.test.ts` — add tests

**Step 1: Write the failing tests**

```typescript
describe('anthropicMessagesToPrompt — tool use', () => {
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
```

**Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — tool_use blocks not handled yet

**Step 3: Update implementation**

Update `anthropicMessagesToPrompt` — replace the `textFromContent` helper:

```typescript
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
```

**Step 4: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/transform.ts src/transform.test.ts
git commit -m "feat: handle tool_use/tool_result in anthropicMessagesToPrompt"
```

---

### Task 3: Embed tool definitions in prompt

Create a function that converts Anthropic `tools[]` into a system prompt instruction block, telling the model how to respond with tool calls.

**Files:**
- Modify: `src/transform.ts` — add `anthropicToolsToPrompt()`
- Modify: `src/transform.test.ts` — add tests

**Step 1: Write the failing tests**

```typescript
import {
  // ... existing imports ...
  anthropicToolsToPrompt,
} from './transform.js'

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
```

**Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL

**Step 3: Write implementation**

Add to `src/transform.ts`:

```typescript
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
```

**Step 4: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/transform.ts src/transform.test.ts
git commit -m "feat: add anthropicToolsToPrompt for prompt-based tool calling"
```

---

### Task 4: Build full Anthropic prompt

Create a function that combines system, tools, and messages into the final prompt string for 1min.ai.

**Files:**
- Modify: `src/transform.ts` — add `toAnthropicPrompt()`
- Modify: `src/transform.test.ts` — add tests

**Step 1: Write the failing tests**

```typescript
import {
  // ... existing imports ...
  toAnthropicPrompt,
} from './transform.js'

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
```

**Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL

**Step 3: Write implementation**

```typescript
export function toAnthropicPrompt(body: {
  messages: { role: string; content: string | any[] }[]
  system?: string
  tools?: any[]
}): string {
  const toolPrompt = anthropicToolsToPrompt(body.tools)
  const systemParts = [body.system, toolPrompt].filter(Boolean).join('\n\n')
  return anthropicMessagesToPrompt(body.messages, systemParts || undefined)
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/transform.ts src/transform.test.ts
git commit -m "feat: add toAnthropicPrompt combining system, tools, and messages"
```

---

### Task 5: Parse response — detect tool call vs text

Create a function that takes the 1min.ai text response and determines if it's a tool call JSON or plain text, returning the appropriate Anthropic content blocks.

**Files:**
- Modify: `src/transform.ts` — add `parseAnthropicResponse()`
- Modify: `src/transform.test.ts` — add tests

**Step 1: Write the failing tests**

```typescript
import {
  // ... existing imports ...
  parseAnthropicResponse,
} from './transform.js'

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
})
```

**Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL

**Step 3: Write implementation**

```typescript
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
```

**Step 4: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/transform.ts src/transform.test.ts
git commit -m "feat: add parseAnthropicResponse for tool call detection"
```

---

### Task 6: Anthropic non-streaming response format

Create function to build a complete Anthropic Messages API response object.

**Files:**
- Modify: `src/transform.ts` — add `toAnthropicResponse()`
- Modify: `src/transform.test.ts` — add tests

**Step 1: Write the failing tests**

```typescript
import {
  // ... existing imports ...
  toAnthropicResponse,
} from './transform.js'

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
```

**Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL

**Step 3: Write implementation**

```typescript
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
```

**Step 4: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/transform.ts src/transform.test.ts
git commit -m "feat: add toAnthropicResponse for Messages API format"
```

---

### Task 7: Anthropic streaming event helpers

Create helpers that generate the SSE event sequence for Anthropic streaming. Event flow:
`message_start` → `content_block_start` → `content_block_delta` (repeated) → `content_block_stop` → `message_delta` → `message_stop`

**Files:**
- Modify: `src/transform.ts` — add `anthropicStreamEvents()`
- Modify: `src/transform.test.ts` — add tests

**Step 1: Write the failing tests**

```typescript
import {
  // ... existing imports ...
  anthropicStreamEvents,
} from './transform.js'

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
```

**Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL

**Step 3: Write implementation**

```typescript
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
```

**Step 4: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/transform.ts src/transform.test.ts
git commit -m "feat: add anthropicStreamEvents for Messages API streaming"
```

---

### Task 8: POST /anthropic/v1/messages route — non-streaming

Wire up the non-streaming Anthropic Messages endpoint.

**Files:**
- Modify: `src/index.ts` — add route

**Step 1: Add the route**

Add to `src/index.ts` before the `serve()` call:

```typescript
// POST /anthropic/v1/messages — Anthropic Messages API
app.post('/anthropic/v1/messages', async (c) => {
  const body = await c.req.json()

  // API key: x-api-key header > Authorization Bearer > env
  const xApiKey = c.req.header('x-api-key')
  const authHeader = c.req.header('Authorization')
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined
  const apiKey = getApiKey(xApiKey ?? bearerToken, config.apiKey)

  if (!apiKey) {
    return c.json({
      type: 'error',
      error: { type: 'authentication_error', message: 'API key is required' },
    }, 401)
  }

  const model = resolveModelName(body.model, config.modelMapping)
  const prompt = toAnthropicPrompt(body)
  const oneMinReq = toOneMinAiRequest({ model, prompt, images: [], webSearch: false })

  if (body.stream) {
    // (streaming handled in Task 9)
  }

  // Non-streaming
  try {
    const data = await chatWithAi(oneMinReq, apiKey)
    const rawText = fromOneMinAiResponse(data)
    return c.json(toAnthropicResponse(rawText, model))
  } catch (err: any) {
    const status = err.status || 502
    return c.json({
      type: 'error',
      error: { type: 'api_error', message: err.message || 'Upstream error' },
    }, status)
  }
})
```

Update imports at top of `src/index.ts` to include the new functions:
```typescript
import { ..., toAnthropicPrompt, toAnthropicResponse } from './transform.js'
```

**Step 2: Test manually**

Run: `API_KEY=<key> pnpm dev`

```bash
curl http://localhost:11434/anthropic/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: test" \
  -d '{"model":"claude-sonnet-4-20250514","max_tokens":100,"messages":[{"role":"user","content":"Say hi in 3 words"}]}'
```

Expected: Anthropic Messages API format response with `type: "message"`

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add POST /anthropic/v1/messages non-streaming route"
```

---

### Task 9: POST /anthropic/v1/messages route — streaming

Add streaming support. The tricky part: we accumulate the full response text, then at the end determine if it's a tool call or text, and emit the appropriate Anthropic SSE events.

Strategy: Buffer all streaming chunks. On done, parse with `parseAnthropicResponse()`. Emit the full Anthropic SSE event sequence.

Note: This means text won't stream incrementally (it buffers first). This is a known trade-off — streaming text incrementally would require real-time detection of tool calls mid-stream, which is fragile. We can optimize later if needed.

**Alternative (better UX):** Stream text deltas in real-time. If the final accumulated text turns out to be a tool call, we need to handle that. Since tool calls are typically short JSON-only responses, we can use a heuristic: if the first chunk starts with `{`, buffer everything and emit as tool_use at the end. Otherwise, stream as text.

**Files:**
- Modify: `src/index.ts` — add streaming to the anthropic route

**Step 1: Implement streaming**

Replace the `if (body.stream)` block in the `/anthropic/v1/messages` route:

```typescript
  if (body.stream) {
    return streamSSE(c, async (stream) => {
      const events = anthropicStreamEvents(model)
      let fullText = ''
      let firstChunk = true
      let isBuffering = false

      try {
        // Send message_start + ping
        await stream.writeSSE({ event: events.messageStart().event, data: JSON.stringify(events.messageStart().data) })
        await stream.writeSSE({ event: events.ping().event, data: JSON.stringify(events.ping().data) })

        for await (const { event, data } of chatWithAiStream(oneMinReq, apiKey)) {
          if (event === 'content') {
            const parsed = JSON.parse(data)
            const chunk = parsed.content

            if (firstChunk) {
              firstChunk = false
              // Heuristic: if starts with '{', likely a tool call — buffer everything
              if (chunk.trimStart().startsWith('{')) {
                isBuffering = true
              } else {
                // Start text streaming
                await stream.writeSSE({ event: events.contentBlockStart(0, 'text').event, data: JSON.stringify(events.contentBlockStart(0, 'text').data) })
              }
            }

            fullText += chunk

            if (!isBuffering) {
              await stream.writeSSE({ event: events.textDelta(0, chunk).event, data: JSON.stringify(events.textDelta(0, chunk).data) })
            }
          } else if (event === 'done') {
            if (isBuffering) {
              // Parse buffered response
              const result = parseAnthropicResponse(fullText)
              if (result.type === 'tool_use') {
                const toolBlock = result.content.find((b: any) => b.type === 'tool_use')
                await stream.writeSSE({ event: events.contentBlockStart(0, 'tool_use', { id: toolBlock.id, name: toolBlock.name }).event, data: JSON.stringify(events.contentBlockStart(0, 'tool_use', { id: toolBlock.id, name: toolBlock.name }).data) })
                await stream.writeSSE({ event: events.inputJsonDelta(0, JSON.stringify(toolBlock.input)).event, data: JSON.stringify(events.inputJsonDelta(0, JSON.stringify(toolBlock.input)).data) })
                await stream.writeSSE({ event: events.contentBlockStop(0).event, data: JSON.stringify(events.contentBlockStop(0).data) })
                await stream.writeSSE({ event: events.messageDelta('tool_use').event, data: JSON.stringify(events.messageDelta('tool_use').data) })
              } else {
                // Was buffering but turned out to be text
                await stream.writeSSE({ event: events.contentBlockStart(0, 'text').event, data: JSON.stringify(events.contentBlockStart(0, 'text').data) })
                await stream.writeSSE({ event: events.textDelta(0, fullText).event, data: JSON.stringify(events.textDelta(0, fullText).data) })
                await stream.writeSSE({ event: events.contentBlockStop(0).event, data: JSON.stringify(events.contentBlockStop(0).data) })
                await stream.writeSSE({ event: events.messageDelta('end_turn').event, data: JSON.stringify(events.messageDelta('end_turn').data) })
              }
            } else {
              // Normal text streaming — close the block
              await stream.writeSSE({ event: events.contentBlockStop(0).event, data: JSON.stringify(events.contentBlockStop(0).data) })
              await stream.writeSSE({ event: events.messageDelta('end_turn').event, data: JSON.stringify(events.messageDelta('end_turn').data) })
            }
            await stream.writeSSE({ event: events.messageStop().event, data: JSON.stringify(events.messageStop().data) })
          }
        }
      } catch (err: any) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ type: 'error', error: { type: 'api_error', message: err.message || 'Upstream error' } }),
        })
      }
    })
  }
```

Update imports at top of `src/index.ts`:
```typescript
import { ..., anthropicStreamEvents, parseAnthropicResponse } from './transform.js'
```

**Step 2: Test manually — text streaming**

```bash
curl http://localhost:11434/anthropic/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: test" \
  -d '{"model":"claude-sonnet-4-20250514","max_tokens":100,"stream":true,"messages":[{"role":"user","content":"Say hi"}]}'
```

Expected: SSE events with `message_start`, `content_block_start`, `content_block_delta` (text), `content_block_stop`, `message_delta`, `message_stop`

**Step 3: Test manually — tool use streaming**

```bash
curl http://localhost:11434/anthropic/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: test" \
  -d '{"model":"claude-sonnet-4-20250514","max_tokens":500,"stream":true,"tools":[{"name":"get_weather","description":"Get weather","input_schema":{"type":"object","properties":{"location":{"type":"string"}}}}],"messages":[{"role":"user","content":"What is the weather in Tokyo? Use the tool."}]}'
```

Expected: SSE events with tool_use content block

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: add streaming support to POST /anthropic/v1/messages"
```

---

### Task 10: Update startup banner and CLAUDE.md

**Files:**
- Modify: `src/index.ts` — add Anthropic line to banner
- Modify: `CLAUDE.md` — add endpoint documentation

**Step 1: Update startup banner**

In `src/index.ts`, in the `serve()` callback, add after the Ollama line:

```typescript
  console.log(`  Anthropic: http://localhost:${info.port}/anthropic/v1/messages`)
```

**Step 2: Update CLAUDE.md endpoints table**

Add row to the Endpoints table:

```markdown
| POST | `/anthropic/v1/messages` | Anthropic Messages API (streaming SSE + non-streaming, prompt-based tool calling) |
```

Add to Manual Testing section:

```markdown
# Anthropic Messages API
curl http://localhost:11434/anthropic/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"model":"claude-sonnet-4-20250514","max_tokens":100,"messages":[{"role":"user","content":"Say hi"}]}'

# Claude Code CLI usage:
# ANTHROPIC_BASE_URL=http://localhost:11434/anthropic pnpm claude-code
```

**Step 3: Commit**

```bash
git add src/index.ts CLAUDE.md
git commit -m "docs: update banner and CLAUDE.md with Anthropic endpoint"
```

---

### Task 11: End-to-end verification

**Step 1: Run all tests**

```bash
pnpm test
```

Expected: ALL PASS

**Step 2: Run type check**

```bash
pnpm exec tsc --noEmit
```

Expected: No errors

**Step 3: Manual e2e test with real API key**

```bash
# Load .env
export $(cat .env | xargs)
pnpm dev &

# Non-streaming text
curl -s http://localhost:11434/anthropic/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4-20250514","max_tokens":50,"messages":[{"role":"user","content":"Say hi in 3 words"}]}'

# Streaming text
curl -s http://localhost:11434/anthropic/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4-20250514","max_tokens":50,"stream":true,"messages":[{"role":"user","content":"Say hi"}]}'

# Tool use
curl -s http://localhost:11434/anthropic/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4-20250514","max_tokens":200,"tools":[{"name":"get_weather","description":"Get weather","input_schema":{"type":"object","properties":{"location":{"type":"string"}},"required":["location"]}}],"messages":[{"role":"user","content":"What is the weather in Tokyo?"}]}'
```

**Step 4: Commit final state**

```bash
git add -A
git commit -m "feat: complete Anthropic Messages API with prompt-based tool calling"
```
