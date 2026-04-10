# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A relay server that translates OpenAI and Ollama compatible API calls into 1min.ai API calls. Clients like Cursor, Continue, or any OpenAI/Ollama-compatible tool can use 1min.ai as a backend through this server.

## Commands

```bash
pnpm dev          # Start dev server with hot reload (tsx watch)
pnpm start        # Start server
pnpm test         # Run all tests (vitest)
pnpm test:watch   # Run tests in watch mode
```

Type check without emitting: `pnpm exec tsc --noEmit`

## Architecture

```
Client → index.ts (route registry) → {openai,ollama,anthropic}/routes.ts → core/transform.ts → oneminai.ts → 1min.ai
```

Organized by API format, with shared infrastructure:

- **`src/index.ts`** — Hono app composition root: CORS, health check, registers routes from each API module. ~40 lines.
- **`src/core/types.ts`** — Shared types (`Message`, `ContentPart`, `OneMinAiRequestInput`, `ROLE_PREFIX`).
- **`src/core/transform.ts`** — Shared transform functions (`messagesToPrompt`, `extractImages`, `toOneMinAiRequest`, `fromOneMinAiResponse`, `extractWebSearch`). Pure functions, no I/O.
- **`src/openai/`** — OpenAI Chat Completions + Responses API. `transform.ts` (response formatters, streaming events), `routes.ts` (3 routes).
- **`src/ollama/`** — Ollama Chat + Generate API. `transform.ts` (response formatters), `routes.ts` (3 routes).
- **`src/anthropic/`** — Anthropic Messages API. `transform.ts` (prompt building, tool parsing, streaming events, model info), `routes.ts` (4 routes + middleware).
- **`src/config.ts`** — Model list, model name mapping, API key resolution. Pure functions + config object export.
- **`src/oneminai.ts`** — HTTP client for 1min.ai. `chatWithAi` (JSON), `chatWithAiStream` (async SSE generator), asset upload.

## Key Design Decisions

- **Two streaming formats**: OpenAI routes use SSE (`streamSSE` from Hono), Ollama routes use NDJSON (`ReadableStream` with `\n`-delimited JSON). Don't mix them.
- **Two error formats**: OpenAI routes return `{ error: { message, type, code } }`, Ollama routes return `{ "error": "string" }`.
- **Ollama defaults to stream=true** (`stream !== false`), OpenAI defaults to stream=false (`stream === true`).
- **API key priority**: `API_KEY` env var first; if not set, falls back to request `Authorization: Bearer <key>`.
- **Model mapping**: `MODEL_MAPPING` env var is a JSON string mapping alias names to actual 1min.ai model names. `resolveModelName()` resolves aliases transparently.
- **Messages to prompt**: 1min.ai only accepts a single `prompt` string. Multi-turn conversations are serialized with `[System]`/`[User]`/`[Assistant]` prefixes. Single user message has no prefix.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `API_KEY` | — | 1min.ai API key (fallback if no Bearer token) |
| `PORT` | `11434` | Server port (11434 = Ollama default) |
| `MODEL_MAPPING` | `{}` | JSON string: `{"alias": "actual-model-name"}` |
| `DEBUG` | — | Set to `1` or `true` to enable 1min.ai request/response logging |

## Endpoints

| Method | Path | Format |
|---|---|---|
| GET | `/health` | `{"status":"ok"}` |
| GET | `/v1/models` | OpenAI model list |
| GET | `/api/tags` | Ollama model list |
| POST | `/v1/chat/completions` | OpenAI chat (streaming SSE + non-streaming) |
| POST | `/v1/responses` | OpenAI Responses API (streaming SSE + non-streaming) |
| POST | `/api/chat` | Ollama chat (streaming NDJSON + non-streaming) |
| POST | `/api/generate` | Ollama generate (streaming NDJSON + non-streaming) |
| POST | `/anthropic/v1/messages` | Anthropic Messages API (streaming SSE + non-streaming, prompt-based tool calling) |

## Manual Testing

```bash
# Set API key and start
export API_KEY=your-1min-ai-key
pnpm dev

# Non-streaming
curl http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Say hi"}]}'

# Streaming (SSE)
curl http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Say hi"}],"stream":true}'

# Ollama chat (NDJSON streaming by default)
curl http://localhost:11434/api/chat \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Say hi"}],"stream":false}'

# Ollama generate
curl http://localhost:11434/api/generate \
  -d '{"model":"gpt-4o-mini","prompt":"Say hi","stream":false}'

# Image vision
curl http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":[{"type":"text","text":"What is this?"},{"type":"image_url","image_url":{"url":"https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Cat03.jpg/1200px-Cat03.jpg"}}]}]}'

# Web search
curl http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Latest tech news today"}],"web_search_options":{}}'

# Anthropic Messages API (non-streaming)
curl http://localhost:11434/anthropic/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"model":"claude-sonnet-4-20250514","max_tokens":100,"messages":[{"role":"user","content":"Say hi"}]}'

# Anthropic Messages API (streaming)
curl http://localhost:11434/anthropic/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"model":"claude-sonnet-4-20250514","max_tokens":100,"stream":true,"messages":[{"role":"user","content":"Say hi"}]}'

# Claude Code CLI usage:
# ANTHROPIC_BASE_URL=http://localhost:11434/anthropic claude
```
