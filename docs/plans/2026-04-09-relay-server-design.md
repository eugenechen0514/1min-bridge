# 1min.ai OpenAI/Ollama Compatible Relay Server — Design

## Overview

A lightweight relay server that exposes OpenAI and Ollama compatible API interfaces, internally proxying requests to the 1min.ai Chat API. Allows tools like Cursor, Continue, and other OpenAI/Ollama-compatible clients to use 1min.ai as a backend.

## Tech Stack

- **Runtime**: Node.js + TypeScript
- **Framework**: Hono
- **Runner**: tsx (no build step)
- **Package Manager**: pnpm
- **Deployment**: Local development only (no Docker)

## Endpoints

| Endpoint | Method | Description | Features |
|---|---|---|---|
| `/v1/chat/completions` | POST | OpenAI Chat Completions (streaming + non-streaming) | Image vision, Web Search |
| `/v1/models` | GET | OpenAI model list | Model Mapping |
| `/api/chat` | POST | Ollama Chat (streaming + non-streaming) | Image vision |
| `/api/generate` | POST | Ollama Generate (streaming + non-streaming) | — |
| `/api/tags` | GET | Ollama model list | Model Mapping |
| `/health` | GET | Health check | — |

## Architecture

```
Client (Cursor / Continue / etc.)
  │
  │  OpenAI format: POST /v1/chat/completions
  │  Ollama format: POST /api/chat
  ▼
┌─────────────────────────────┐
│  Hono Relay Server (:11434) │
│                             │
│  1. Resolve API Key         │
│     Bearer token > env var  │
│  2. Resolve model name      │
│     alias → actual via map  │
│  3. Transform request       │
│     OpenAI/Ollama → 1min.ai │
│  4. Call 1min.ai API        │
│  5. Transform response      │
│     1min.ai → OpenAI/Ollama │
└─────────────┬───────────────┘
              │
              ▼
    https://api.1min.ai/api/chat-with-ai
```

**Default port**: `11434` (Ollama default, easy drop-in replacement). Overridable via `PORT` env var.

## API Key Resolution

Priority order:
1. Request `Authorization: Bearer <key>` header (if present)
2. Environment variable `API_KEY` (fallback)

## Model Mapping

- `DEFAULT_MODELS`: Full list of 1min.ai available models (hardcoded in config)
- `MODEL_MAPPING` env var: JSON string mapping alias → actual model name
  - Example: `{"my-fast": "gpt-4o-mini", "my-smart": "claude-opus-4-6"}`
- `resolveModelName(model, mapping)`: Returns `mapping[model] ?? model`
- `getModelList(mapping)`: Returns `DEFAULT_MODELS + aliases`, deduplicated

## Request Transformation

### Messages → Prompt

OpenAI/Ollama use `messages[]` array. 1min.ai accepts a single `prompt` string.

Strategy: Concatenate all messages into a structured prompt:
```
[System] You are a helpful assistant.
[User] Hello
[Assistant] Hi there!
[User] How are you?
```

### Image Vision

```
OpenAI: messages[].content[{type: "image_url", image_url: {url: "..."}}]
  → 1min.ai: promptObject.attachments.images: ["url"]
```

### Web Search

```
OpenAI: web_search_options: {}
  → 1min.ai: promptObject.settings.webSearchSettings: { webSearch: true }
```

### Parameters

`temperature`, `max_tokens`, etc. are ignored (1min.ai doesn't support them).

## Response Transformation

### Non-streaming

```
1min.ai: aiRecord.aiRecordDetail.resultObject[0]
  → OpenAI: { id, object: "chat.completion", choices: [{message: {role, content}, finish_reason: "stop"}], model, usage }
  → Ollama: { model, message: {role, content}, done: true }
```

### Streaming

**OpenAI SSE** (`/v1/chat/completions`):
```
1min.ai event: content → data: {"choices":[{"delta":{"content":"..."}}]}\n\n
1min.ai event: done    → data: [DONE]\n\n
```

**Ollama NDJSON** (`/api/chat`, `/api/generate`):
```
1min.ai event: content → {"model":"...","message":{"role":"assistant","content":"..."},"done":false}\n
1min.ai event: done    → {"model":"...","message":{"role":"assistant","content":""},"done":true}\n
```

## Error Handling

Errors from 1min.ai are transformed to match the format of the route:

| 1min.ai Status | Relay Status | Description |
|---|---|---|
| 401 | 401 | Invalid API Key |
| 400 | 400 | Bad request |
| 422 | 400 | Validation error |
| 429 | 429 | Rate limited |
| 5xx | 502 | Upstream error |

**OpenAI format**: `{ "error": { "message", "type", "code" } }`
**Ollama format**: `{ "error": "message" }`

## File Structure

```
src/
  index.ts        # Hono app, all routes, startup
  config.ts       # Model list, model mapping, settings
  transform.ts    # OpenAI/Ollama ↔ 1min.ai format conversion
  oneminai.ts     # 1min.ai API client (streaming + non-streaming)
package.json
tsconfig.json
.env.example
.gitignore
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `API_KEY` | — | 1min.ai API Key (fallback) |
| `PORT` | `11434` | Server port |
| `MODEL_MAPPING` | `{}` | JSON string: alias → actual model name |

## Available Models (Default)

### OpenAI
gpt-5.4, gpt-5.4-pro, gpt-5.4-mini, gpt-5.4-nano, gpt-5.2, gpt-5.2-pro, gpt-5.1, gpt-5.1-codex, gpt-5.1-codex-mini, gpt-5, gpt-5-chat-latest, gpt-5-mini, gpt-5-nano, gpt-4o, gpt-4o-mini, gpt-4.1, gpt-4.1-mini, gpt-4.1-nano, gpt-4-turbo, gpt-3.5-turbo, o4-mini, o3, o3-mini, o3-pro, o3-deep-research, o4-mini-deep-research

### Anthropic
claude-opus-4-6, claude-opus-4-5-20251101, claude-opus-4-20250514, claude-opus-4-1-20250805, claude-sonnet-4-6, claude-sonnet-4-5-20250929, claude-sonnet-4-20250514, claude-haiku-4-5-20251001

### Google
gemini-3.1-pro-preview, gemini-3.1-flash-lite-preview, gemini-3-flash-preview, gemini-2.5-pro, gemini-2.5-flash

### Alibaba
qwen3-vl-plus, qwen3-vl-flash, qwen3-max, qwen-vl-plus, qwen-vl-max, qwen-plus, qwen-max, qwen-flash

### DeepSeek
deepseek-reasoner, deepseek-chat

### Mistral
magistral-small-latest, magistral-medium-latest, ministral-14b-latest, open-mistral-nemo, mistral-small-latest, mistral-medium-latest, mistral-large-latest

### xAI
grok-4-fast-reasoning, grok-4-fast-non-reasoning, grok-4-0709, grok-3-mini, grok-3

### Perplexity
sonar-reasoning-pro, sonar-pro, sonar-deep-research, sonar

### Cohere
command-r-08-2024

### Meta (Extra)
meta/meta-llama-3.1-405b-instruct, meta/meta-llama-3-70b-instruct, meta/llama-4-scout-instruct, meta/llama-4-maverick-instruct, meta/llama-2-70b-chat, openai/gpt-oss-20b, openai/gpt-oss-120b

## Out of Scope (Future)

- `/v1/responses` (OpenAI Responses API)
- File Search / Attachments (requires Responses API)
- Docker / production deployment
- Authentication beyond API Key pass-through
