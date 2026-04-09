# 1min.ai Relay Server Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a relay server that translates OpenAI/Ollama API calls into 1min.ai API calls, supporting streaming, image vision, and web search.

**Architecture:** Single Hono app with 4 source files — config (models + mapping), transform (format conversion), oneminai (API client), index (routes). All request/response format translation is pure functions in transform.ts, making them testable without network calls.

**Tech Stack:** Node.js, TypeScript, Hono, tsx, pnpm

**Design doc:** `docs/plans/2026-04-09-relay-server-design.md`

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.env.example`

**Step 1: Initialize project and install dependencies**

```bash
cd /Users/eugene/Documents/Projects/1min-openai-api
pnpm init
pnpm add hono @hono/node-server
pnpm add -D typescript tsx @types/node
```

**Step 2: Create tsconfig.json**

Create `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

**Step 3: Create .gitignore**

```
node_modules/
dist/
.env
```

**Step 4: Create .env.example**

```
API_KEY=
PORT=11434
MODEL_MAPPING={}
```

**Step 5: Add scripts to package.json**

Add to `package.json`:
```json
{
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts"
  }
}
```

**Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json .gitignore .env.example
git commit -m "chore: init project with hono, tsx, typescript"
```

---

### Task 2: Config — Models & Mapping

**Files:**
- Create: `src/config.ts`
- Test: `src/config.test.ts`

**Step 1: Write failing tests for config**

Create `src/config.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { resolveModelName, getModelList, getApiKey } from './config.js'

describe('resolveModelName', () => {
  it('returns mapped name when alias exists', () => {
    const mapping = { 'my-fast': 'gpt-4o-mini' }
    expect(resolveModelName('my-fast', mapping)).toBe('gpt-4o-mini')
  })

  it('returns original name when no alias', () => {
    const mapping = { 'my-fast': 'gpt-4o-mini' }
    expect(resolveModelName('gpt-4o', mapping)).toBe('gpt-4o')
  })
})

describe('getModelList', () => {
  it('includes default models', () => {
    const list = getModelList({})
    expect(list.some(m => m.id === 'gpt-4o')).toBe(true)
  })

  it('includes alias models', () => {
    const list = getModelList({ 'my-model': 'gpt-4o' })
    expect(list.some(m => m.id === 'my-model')).toBe(true)
  })

  it('deduplicates when alias matches default', () => {
    const list = getModelList({ 'gpt-4o': 'gpt-4o-mini' })
    const gpt4oEntries = list.filter(m => m.id === 'gpt-4o')
    expect(gpt4oEntries).toHaveLength(1)
  })
})

describe('getApiKey', () => {
  it('prefers header over env', () => {
    expect(getApiKey('header-key', 'env-key')).toBe('header-key')
  })

  it('falls back to env when no header', () => {
    expect(getApiKey(undefined, 'env-key')).toBe('env-key')
  })

  it('returns undefined when neither set', () => {
    expect(getApiKey(undefined, undefined)).toBeUndefined()
  })
})
```

**Step 2: Install vitest and run test to verify it fails**

```bash
pnpm add -D vitest
```

Add to `package.json` scripts: `"test": "vitest run"`, `"test:watch": "vitest"`

Run: `pnpm test`
Expected: FAIL — module `./config.js` not found

**Step 3: Write config.ts implementation**

Create `src/config.ts` with:
- `ModelInfo` interface: `{ id, object, created, owned_by }`
- `DEFAULT_MODELS` array with all models from design doc (each with correct `owned_by`)
- `modelMapping`: parsed from `process.env.MODEL_MAPPING || '{}'`
- `resolveModelName(model, mapping)`: returns `mapping[model] ?? model`
- `getModelList(mapping)`: merges defaults + aliases, deduplicates by id
- `getApiKey(headerKey?, envKey?)`: returns `headerKey ?? envKey`
- Export `config` object: `{ port, apiKey, modelMapping }`

Full model list (use `owned_by` from provider name):
- OpenAI models → `"openai"`
- Anthropic → `"anthropic"`
- Google → `"google"`
- Alibaba → `"alibaba"`
- DeepSeek → `"deepseek"`
- Mistral → `"mistral"`
- xAI → `"xai"`
- Perplexity → `"perplexity"`
- Cohere → `"cohere"`
- Meta/Extra → `"meta"` / `"openai"`

**Step 4: Run tests to verify they pass**

Run: `pnpm test`
Expected: All 6 tests PASS

**Step 5: Commit**

```bash
git add src/config.ts src/config.test.ts package.json
git commit -m "feat: add config with model list, mapping, and api key resolution"
```

---

### Task 3: Transform — Format Conversion

**Files:**
- Create: `src/transform.ts`
- Test: `src/transform.test.ts`

**Step 1: Write failing tests for transform functions**

Create `src/transform.test.ts` covering:

```typescript
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
} from './transform.js'

describe('messagesToPrompt', () => {
  it('converts single user message', () => {
    const messages = [{ role: 'user', content: 'Hello' }]
    expect(messagesToPrompt(messages)).toBe('Hello')
  })

  it('converts multi-turn with system', () => {
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

  it('handles single user message without role prefix', () => {
    const messages = [{ role: 'user', content: 'Just one message' }]
    expect(messagesToPrompt(messages)).toBe('Just one message')
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
})

describe('extractWebSearch', () => {
  it('returns false when no web_search_options', () => {
    expect(extractWebSearch(undefined)).toBe(false)
  })

  it('returns true when web_search_options is set', () => {
    expect(extractWebSearch({})).toBe(true)
  })
})

describe('toOneMinAiRequest', () => {
  it('builds correct 1min.ai request body', () => {
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

describe('toOpenAiResponse', () => {
  it('wraps content in OpenAI chat completion format', () => {
    const result = toOpenAiResponse('Hello!', 'gpt-4o')
    expect(result.object).toBe('chat.completion')
    expect(result.choices[0].message.content).toBe('Hello!')
    expect(result.choices[0].message.role).toBe('assistant')
    expect(result.choices[0].finish_reason).toBe('stop')
    expect(result.model).toBe('gpt-4o')
  })
})

describe('toOpenAiStreamChunk', () => {
  it('wraps content delta in SSE chunk format', () => {
    const chunk = toOpenAiStreamChunk('Hi', 'gpt-4o')
    expect(chunk.object).toBe('chat.completion.chunk')
    expect(chunk.choices[0].delta.content).toBe('Hi')
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
  it('wraps content in Ollama streaming chunk', () => {
    const chunk = toOllamaChatStreamChunk('Hi', 'gpt-4o', false)
    expect(chunk.done).toBe(false)
    expect(chunk.message.content).toBe('Hi')
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
  it('wraps content in Ollama generate streaming chunk', () => {
    const chunk = toOllamaGenerateStreamChunk('Hi', 'gpt-4o', false)
    expect(chunk.done).toBe(false)
    expect(chunk.response).toBe('Hi')
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — module `./transform.js` not found

**Step 3: Write transform.ts implementation**

Create `src/transform.ts` with all functions matching the test expectations:

- `messagesToPrompt(messages)`: If single user message, return content as-is. If multi-turn, prefix each with `[Role]`.
- `extractImages(messages)`: Scan content arrays for `type: "image_url"`, collect URLs.
- `extractWebSearch(webSearchOptions)`: Returns `webSearchOptions != null`.
- `toOneMinAiRequest({ model, prompt, images, webSearch })`: Build 1min.ai request body. Only include `attachments` if images non-empty. Only include `settings` if webSearch true.
- `fromOneMinAiResponse(data)`: Extract `aiRecord.aiRecordDetail.resultObject[0]`.
- `toOpenAiResponse(content, model)`: Build `{ id: "chatcmpl-" + crypto.randomUUID(), object: "chat.completion", ... }`.
- `toOpenAiStreamChunk(content, model)`: Build `{ id, object: "chat.completion.chunk", choices: [{ delta: { content } }] }`.
- `toOllamaChatResponse(content, model)`: Build `{ model, message: { role: "assistant", content }, done: true }`.
- `toOllamaChatStreamChunk(content, model, done)`: Build `{ model, message: { role: "assistant", content }, done }`.
- `toOllamaGenerateResponse(content, model)`: Build `{ model, response: content, done: true }`.
- `toOllamaGenerateStreamChunk(content, model, done)`: Build `{ model, response: content, done }`.

**Step 4: Run tests to verify they pass**

Run: `pnpm test`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/transform.ts src/transform.test.ts
git commit -m "feat: add request/response transform functions with tests"
```

---

### Task 4: 1min.ai API Client

**Files:**
- Create: `src/oneminai.ts`

**Step 1: Write oneminai.ts**

Create `src/oneminai.ts` with two exported functions:

```typescript
// Non-streaming: calls 1min.ai and returns parsed JSON
export async function chatWithAi(body: OneMinAiRequest, apiKey: string): Promise<OneMinAiResponse>

// Streaming: calls 1min.ai with ?isStreaming=true, returns a ReadableStream
// that yields { event: string, data: string } objects parsed from SSE
export async function chatWithAiStream(body: OneMinAiRequest, apiKey: string): AsyncGenerator<{ event: string; data: string }>
```

Implementation details:
- Base URL: `https://api.1min.ai/api/chat-with-ai`
- Headers: `{ "API-KEY": apiKey, "Content-Type": "application/json" }`
- Non-streaming: `fetch(url, { method: "POST", headers, body: JSON.stringify(body) })`, check status, return `.json()`
- Streaming: `fetch(url + "?isStreaming=true", ...)`, read `response.body` as text stream, parse SSE lines (`event:` and `data:` fields), yield parsed events
- On non-2xx response: throw an error object with `{ status, message }` from the response body

**Step 2: Verify TypeScript compiles**

Run: `pnpm exec tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/oneminai.ts
git commit -m "feat: add 1min.ai API client with streaming support"
```

---

### Task 5: Routes — Health, Models, Tags

**Files:**
- Create: `src/index.ts`

**Step 1: Write index.ts with basic app and simple routes**

Create `src/index.ts`:

```typescript
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { config, getModelList, getApiKey } from './config.js'

const app = new Hono()

// GET /health
app.get('/health', (c) => c.json({ status: 'ok' }))

// GET /v1/models
app.get('/v1/models', (c) => {
  const models = getModelList(config.modelMapping)
  return c.json({
    object: 'list',
    data: models,
  })
})

// GET /api/tags
app.get('/api/tags', (c) => {
  const models = getModelList(config.modelMapping)
  return c.json({
    models: models.map(m => ({
      name: m.id,
      model: m.id,
      modified_at: new Date().toISOString(),
      size: 0,
    })),
  })
})

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`1min.ai relay server running on http://localhost:${info.port}`)
})
```

**Step 2: Run and manually test**

```bash
pnpm dev &
curl http://localhost:11434/health
curl http://localhost:11434/v1/models | jq '.data | length'
curl http://localhost:11434/api/tags | jq '.models | length'
```

Expected: health returns `{"status":"ok"}`, models/tags return the full list.

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add health, /v1/models, /api/tags routes"
```

---

### Task 6: Route — /v1/chat/completions (Non-Streaming)

**Files:**
- Modify: `src/index.ts`

**Step 1: Add /v1/chat/completions POST route (non-streaming path)**

In `src/index.ts`, add the route:

1. Parse request body
2. Extract API key: `getApiKey(bearerToken, config.apiKey)`
3. Resolve model: `resolveModelName(body.model, config.modelMapping)`
4. Convert messages to prompt: `messagesToPrompt(body.messages)`
5. Extract images: `extractImages(body.messages)`
6. Extract web search: `extractWebSearch(body.web_search_options)`
7. Build 1min.ai request: `toOneMinAiRequest({ model, prompt, images, webSearch })`
8. If `body.stream !== true`: call `chatWithAi()`, extract content with `fromOneMinAiResponse()`, return `toOpenAiResponse(content, model)`

**Step 2: Add error handling middleware**

Add a middleware or try/catch in the route that catches errors from `chatWithAi()` and returns OpenAI-format errors:
```typescript
{ error: { message, type: "upstream_error", code: status } }
```

Also add a check: if no API key found, return 401 immediately.

**Step 3: Manual test**

```bash
curl http://localhost:11434/v1/chat/completions \
  -H "Authorization: Bearer YOUR_1MIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Say hi in 5 words"}]}'
```

Expected: OpenAI-format JSON response with assistant message.

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: add /v1/chat/completions non-streaming route"
```

---

### Task 7: Route — /v1/chat/completions (Streaming)

**Files:**
- Modify: `src/index.ts`

**Step 1: Add streaming path to /v1/chat/completions**

In the existing route, when `body.stream === true`:

1. Call `chatWithAiStream()` to get an async generator
2. Use Hono's `streamSSE()` helper
3. For each `{ event, data }` from the generator:
   - If event is `content`: parse data JSON, extract `.content`, write SSE with `toOpenAiStreamChunk(content, model)`
   - If event is `done`: write `data: [DONE]\n\n` and close stream
   - If event is `error`: write error chunk and close

**Step 2: Manual test**

```bash
curl http://localhost:11434/v1/chat/completions \
  -H "Authorization: Bearer YOUR_1MIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Say hi"}],"stream":true}'
```

Expected: SSE stream with `data: {...}` chunks ending in `data: [DONE]`.

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add streaming support to /v1/chat/completions"
```

---

### Task 8: Routes — Ollama /api/chat & /api/generate

**Files:**
- Modify: `src/index.ts`

**Step 1: Add POST /api/chat route**

Similar to `/v1/chat/completions` but:
- Request body uses Ollama format (same `messages[]` structure)
- Images: Ollama passes images as base64 in `messages[].images[]` — extract and convert
- Non-streaming: return `toOllamaChatResponse(content, model)`
- Streaming (`body.stream !== false`, Ollama defaults to stream=true): use Hono `stream()` (not SSE), write NDJSON lines using `toOllamaChatStreamChunk()`

**Step 2: Add POST /api/generate route**

- Request body has `prompt` string (not messages), and optional `system` string
- Build prompt: if system present, `[System] ${system}\n[User] ${prompt}`, else just `prompt`
- Non-streaming: return `toOllamaGenerateResponse(content, model)`
- Streaming: write NDJSON lines using `toOllamaGenerateStreamChunk()`

**Step 3: Add Ollama error format middleware**

For `/api/*` routes, errors should be `{ "error": "message string" }` (not OpenAI format).

**Step 4: Manual test**

```bash
# Ollama chat
curl http://localhost:11434/api/chat \
  -H "Authorization: Bearer YOUR_1MIN_KEY" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Say hi"}],"stream":false}'

# Ollama generate
curl http://localhost:11434/api/generate \
  -H "Authorization: Bearer YOUR_1MIN_KEY" \
  -d '{"model":"gpt-4o-mini","prompt":"Say hi in 5 words","stream":false}'
```

Expected: Ollama-format JSON responses.

**Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: add Ollama /api/chat and /api/generate routes"
```

---

### Task 9: Image Vision & Web Search Integration

**Files:**
- Modify: `src/index.ts`
- Modify: `src/transform.ts` (if adjustments needed)

**Step 1: Test image vision through /v1/chat/completions**

```bash
curl http://localhost:11434/v1/chat/completions \
  -H "Authorization: Bearer YOUR_1MIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{
      "role": "user",
      "content": [
        {"type": "text", "text": "What is in this image?"},
        {"type": "image_url", "image_url": {"url": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Cat03.jpg/1200px-Cat03.jpg"}}
      ]
    }]
  }'
```

Expected: Response describing the image.

**Step 2: Test web search through /v1/chat/completions**

```bash
curl http://localhost:11434/v1/chat/completions \
  -H "Authorization: Bearer YOUR_1MIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "What happened in tech news today?"}],
    "web_search_options": {}
  }'
```

Expected: Response with web search results.

**Step 3: Fix any issues found during integration testing**

Debug and fix any transformation or parsing issues.

**Step 4: Commit**

```bash
git add -u
git commit -m "fix: integration fixes for image vision and web search"
```

---

### Task 10: Final Polish & README

**Files:**
- Modify: `src/index.ts` (startup banner)
- Verify all endpoints work

**Step 1: Add startup banner with useful info**

Print on startup:
```
1min.ai Relay Server
  OpenAI: http://localhost:11434/v1/chat/completions
  Ollama: http://localhost:11434/api/chat
  Models: X loaded (Y aliases)
  API Key: from env ✓ / not set
```

**Step 2: Full manual test of all 6 endpoints**

Run through each endpoint with curl to verify everything works end-to-end.

**Step 3: Commit**

```bash
git add -u
git commit -m "feat: add startup banner and final polish"
```
