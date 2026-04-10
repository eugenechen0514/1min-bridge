# 1min-openai-api

A relay server that translates **OpenAI**, **Ollama**, and **Anthropic** compatible API calls into [1min.ai](https://1min.ai) API calls.

Use any AI client -- Cursor, Continue, Claude Code CLI, Open WebUI, or anything that speaks OpenAI/Ollama/Anthropic -- with 1min.ai as the backend. One API key, 73 models from 10 providers.

## Quick Start

```bash
# Install dependencies
pnpm install

# Start the server with your 1min.ai API key
API_KEY=your-1min-ai-key pnpm dev
```

The server starts on port `11434` (Ollama's default) and prints the available endpoints:

```
  1min.ai Relay Server
  ----------------------------------------
  OpenAI:    http://localhost:11434/v1/chat/completions
  Ollama:    http://localhost:11434/api/chat
  Anthropic: http://localhost:11434/anthropic/v1/messages
  Models:  73 loaded
  API Key: from env
  ----------------------------------------
```

## Client Setup

### Claude Code CLI

```bash
# Start the relay server
API_KEY=your-1min-ai-key pnpm dev

# In another terminal, use Claude Code with 1min.ai
ANTHROPIC_BASE_URL=http://localhost:11434/anthropic claude
```

If you changed the port (e.g. `PORT=4444`), adjust the URL accordingly:

```bash
ANTHROPIC_BASE_URL=http://localhost:4444/anthropic claude
```

### Cursor / Continue / OpenAI-compatible clients

Set the base URL to:

```
http://localhost:11434/v1
```

### Ollama-compatible clients

Set the Ollama host to:

```
http://localhost:11434
```

The default port `11434` matches Ollama's default, so many clients work without any configuration change.

## API Endpoints

| Method | Path | Format |
|--------|------|--------|
| GET | `/health` | Health check |
| GET | `/v1/models` | OpenAI model list |
| GET | `/api/tags` | Ollama model list |
| GET | `/anthropic/v1/models` | Anthropic model list |
| GET | `/anthropic/v1/models/:model_id` | Anthropic model info |
| POST | `/v1/chat/completions` | OpenAI Chat Completions (streaming SSE + non-streaming) |
| POST | `/v1/responses` | OpenAI Responses API (streaming SSE + non-streaming) |
| POST | `/api/chat` | Ollama chat (streaming NDJSON + non-streaming) |
| POST | `/api/generate` | Ollama generate (streaming NDJSON + non-streaming) |
| POST | `/anthropic/v1/messages` | Anthropic Messages API (streaming SSE + non-streaming) |

## Usage Examples

### OpenAI -- non-streaming

```bash
curl http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Say hi"}]}'
```

### OpenAI -- streaming

```bash
curl http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Say hi"}],"stream":true}'
```

### Ollama

```bash
curl http://localhost:11434/api/chat \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Say hi"}],"stream":false}'
```

### Anthropic Messages API

```bash
curl http://localhost:11434/anthropic/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-key" \
  -d '{"model":"claude-sonnet-4-20250514","max_tokens":100,"messages":[{"role":"user","content":"Say hi"}]}'
```

### Image vision

```bash
curl http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":[{"type":"text","text":"What is this?"},{"type":"image_url","image_url":{"url":"https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Cat03.jpg/1200px-Cat03.jpg"}}]}]}'
```

### Web search

```bash
curl http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Latest tech news today"}],"web_search_options":{}}'
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `API_KEY` | -- | 1min.ai API key. Takes priority over request headers. |
| `PORT` | `11434` | Server port. |
| `MODEL_MAPPING` | `{}` | JSON string mapping alias names to actual model names. |
| `DEBUG` | -- | Set to `1` or `true` to log all 1min.ai request/response traffic. |

### Model Aliasing

Use `MODEL_MAPPING` to create short names or remap model names:

```bash
MODEL_MAPPING='{"my-model":"claude-sonnet-4-20250514","fast":"gpt-4o-mini"}' API_KEY=your-key pnpm dev
```

Then use the alias in requests:

```bash
curl http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"my-model","messages":[{"role":"user","content":"Hello"}]}'
```

Aliases appear alongside built-in models in the model list endpoints.

### API Key Resolution

The server resolves the API key in this order:

1. `API_KEY` environment variable (if set, always used)
2. Request header (`Authorization: Bearer <key>` for OpenAI/Ollama, `x-api-key` for Anthropic)

This means you can either set the key once via the environment variable, or pass it per-request from your client.

## Supported Models

73 models from 10 providers:

| Provider | Models |
|----------|--------|
| **OpenAI** | GPT-5.4, GPT-5.2, GPT-5.1, GPT-5, GPT-4o, GPT-4.1, GPT-4 Turbo, GPT-3.5 Turbo, o3, o4-mini, and more |
| **Anthropic** | Claude Opus 4, Claude Sonnet 4, Claude Haiku 4.5 |
| **Google** | Gemini 3.1 Pro, Gemini 2.5 Pro, Gemini 2.5 Flash |
| **Alibaba** | Qwen 3, Qwen VL, Qwen Plus/Max/Flash |
| **DeepSeek** | DeepSeek Reasoner, DeepSeek Chat |
| **Mistral** | Magistral, Ministral, Mistral Small/Medium/Large |
| **xAI** | Grok 4, Grok 3 |
| **Perplexity** | Sonar, Sonar Pro, Sonar Deep Research |
| **Cohere** | Command R |
| **Meta** | Llama 4, Llama 3.1, Llama 3, Llama 2 |

The full model list is served at `/v1/models`, `/api/tags`, or `/anthropic/v1/models`.

## Architecture

```
Client (Cursor, Claude Code, etc.)
  |
  v
index.ts          -- Hono routes, request handling
  |
  v
transform.ts      -- Format conversion (OpenAI/Ollama/Anthropic <-> 1min.ai)
  |
  v
oneminai.ts       -- HTTP client for 1min.ai API
  |
  v
1min.ai API
```

Four source files, each with a single responsibility:

- **`src/config.ts`** -- Model list, model name mapping (`MODEL_MAPPING`), API key resolution. Pure functions and config exports.
- **`src/transform.ts`** -- All format conversion. Pure functions, no I/O. Handles the key challenge of converting multi-turn `messages[]` into 1min.ai's single `prompt` string format.
- **`src/oneminai.ts`** -- HTTP client for 1min.ai. Two functions: `chatWithAi` (returns JSON) and `chatWithAiStream` (async generator yielding SSE events).
- **`src/index.ts`** -- Hono app with all routes and `serve()`. No business logic, just wiring.

### Key Design Decisions

- **Two streaming formats**: OpenAI and Anthropic routes use SSE. Ollama routes use NDJSON (newline-delimited JSON).
- **Messages to prompt**: 1min.ai only accepts a single `prompt` string. Multi-turn conversations are serialized with `[System]`/`[User]`/`[Assistant]` prefixes. A single user message is passed through without prefixes.
- **Anthropic tool calling**: 1min.ai does not natively support structured tool calling. Tool definitions are embedded in the prompt text, and the model's JSON tool-call responses are parsed and converted to proper Anthropic `tool_use` content blocks.
- **Streaming defaults**: Ollama defaults to `stream=true` (matching Ollama's behavior). OpenAI defaults to `stream=false`.

## Development

```bash
pnpm dev          # Start dev server with hot reload (tsx watch)
pnpm start        # Start production server
pnpm test         # Run all tests (vitest)
pnpm test:watch   # Run tests in watch mode
```

Type-check without emitting:

```bash
pnpm exec tsc --noEmit
```

### Debug Logging

Enable detailed logging of all requests and responses to/from 1min.ai:

```bash
DEBUG=1 API_KEY=your-key pnpm dev
```

## Tech Stack

- [Hono](https://hono.dev) -- Web framework
- [TypeScript](https://www.typescriptlang.org) -- Type safety
- [tsx](https://github.com/privatenumber/tsx) -- TypeScript execution and watch mode
- [Vitest](https://vitest.dev) -- Testing
- Node.js -- Runtime

## License

ISC
