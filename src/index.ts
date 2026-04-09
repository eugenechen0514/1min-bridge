import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { serve } from '@hono/node-server'
import { config, getModelList, resolveModelName, getApiKey } from './config.js'
import { messagesToPrompt, extractImages, extractWebSearch, toOneMinAiRequest, fromOneMinAiResponse, toOpenAiResponse, toOpenAiStreamChunk, toOllamaChatResponse, toOllamaChatStreamChunk, toOllamaGenerateResponse, toOllamaGenerateStreamChunk } from './transform.js'
import { chatWithAi, chatWithAiStream } from './oneminai.js'

const app = new Hono()

// GET /health
app.get('/health', (c) => c.json({ status: 'ok' }))

// GET /v1/models — OpenAI format
app.get('/v1/models', (c) => {
  const models = getModelList(config.modelMapping)
  return c.json({
    object: 'list',
    data: models,
  })
})

// GET /api/tags — Ollama format
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

// POST /v1/chat/completions
app.post('/v1/chat/completions', async (c) => {
  // 1. Parse body
  const body = await c.req.json()

  // 2. Get API key (Bearer token from Authorization header, fallback to env)
  const authHeader = c.req.header('Authorization')
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined
  const apiKey = getApiKey(bearerToken, config.apiKey)

  if (!apiKey) {
    return c.json({ error: { message: 'API key is required', type: 'invalid_request_error', code: 'missing_api_key' } }, 401)
  }

  // 3. Resolve model name (alias → actual)
  const model = resolveModelName(body.model, config.modelMapping)

  // 4. Transform request
  const prompt = messagesToPrompt(body.messages)
  const images = extractImages(body.messages)
  const webSearch = extractWebSearch(body.web_search_options)
  const oneMinReq = toOneMinAiRequest({ model, prompt, images, webSearch })

  // 5. Handle streaming
  if (body.stream) {
    return streamSSE(c, async (stream) => {
      try {
        for await (const { event, data } of chatWithAiStream(oneMinReq, apiKey)) {
          if (event === 'content') {
            const parsed = JSON.parse(data)
            const chunk = toOpenAiStreamChunk(parsed.content, model)
            await stream.writeSSE({ data: JSON.stringify(chunk) })
          } else if (event === 'done') {
            await stream.writeSSE({ data: '[DONE]' })
          } else if (event === 'error') {
            await stream.writeSSE({ data: JSON.stringify({ error: { message: data } }) })
          }
        }
      } catch (err: any) {
        await stream.writeSSE({ data: JSON.stringify({ error: { message: err.message || 'Upstream error' } }) })
      }
    })
  }

  // 6. Call 1min.ai API
  try {
    const data = await chatWithAi(oneMinReq, apiKey)
    const content = fromOneMinAiResponse(data)
    return c.json(toOpenAiResponse(content, model))
  } catch (err: any) {
    const status = err.status || 502
    const message = err.message || 'Upstream error'
    return c.json({ error: { message, type: 'upstream_error', code: String(status) } }, status)
  }
})

// POST /api/chat — Ollama format
app.post('/api/chat', async (c) => {
  const body = await c.req.json()

  const authHeader = c.req.header('Authorization')
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined
  const apiKey = getApiKey(bearerToken, config.apiKey)

  if (!apiKey) {
    return c.json({ error: 'API key is required' }, 401)
  }

  const model = resolveModelName(body.model, config.modelMapping)
  const prompt = messagesToPrompt(body.messages)
  const images = extractImages(body.messages)
  const oneMinReq = toOneMinAiRequest({ model, prompt, images, webSearch: false })

  // Ollama defaults to streaming (stream !== false means stream)
  if (body.stream !== false) {
    const readable = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()
        try {
          for await (const { event, data } of chatWithAiStream(oneMinReq, apiKey)) {
            if (event === 'content') {
              const parsed = JSON.parse(data)
              const chunk = toOllamaChatStreamChunk(parsed.content, model, false)
              controller.enqueue(encoder.encode(JSON.stringify(chunk) + '\n'))
            } else if (event === 'done') {
              const chunk = toOllamaChatStreamChunk('', model, true)
              controller.enqueue(encoder.encode(JSON.stringify(chunk) + '\n'))
            }
          }
        } catch (err: any) {
          const errChunk = { error: err.message || 'Upstream error' }
          controller.enqueue(encoder.encode(JSON.stringify(errChunk) + '\n'))
        }
        controller.close()
      }
    })
    return new Response(readable, {
      headers: { 'Content-Type': 'application/x-ndjson' },
    })
  }

  // Non-streaming
  try {
    const data = await chatWithAi(oneMinReq, apiKey)
    const content = fromOneMinAiResponse(data)
    return c.json(toOllamaChatResponse(content, model))
  } catch (err: any) {
    const status = err.status || 502
    return c.json({ error: err.message || 'Upstream error' }, status)
  }
})

// POST /api/generate — Ollama format
app.post('/api/generate', async (c) => {
  const body = await c.req.json()

  const authHeader = c.req.header('Authorization')
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined
  const apiKey = getApiKey(bearerToken, config.apiKey)

  if (!apiKey) {
    return c.json({ error: 'API key is required' }, 401)
  }

  const model = resolveModelName(body.model, config.modelMapping)
  const prompt = body.system ? `[System] ${body.system}\n[User] ${body.prompt}` : body.prompt
  const oneMinReq = toOneMinAiRequest({ model, prompt, images: [], webSearch: false })

  // Ollama defaults to streaming
  if (body.stream !== false) {
    const readable = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()
        try {
          for await (const { event, data } of chatWithAiStream(oneMinReq, apiKey)) {
            if (event === 'content') {
              const parsed = JSON.parse(data)
              const chunk = toOllamaGenerateStreamChunk(parsed.content, model, false)
              controller.enqueue(encoder.encode(JSON.stringify(chunk) + '\n'))
            } else if (event === 'done') {
              const chunk = toOllamaGenerateStreamChunk('', model, true)
              controller.enqueue(encoder.encode(JSON.stringify(chunk) + '\n'))
            }
          }
        } catch (err: any) {
          const errChunk = { error: err.message || 'Upstream error' }
          controller.enqueue(encoder.encode(JSON.stringify(errChunk) + '\n'))
        }
        controller.close()
      }
    })
    return new Response(readable, {
      headers: { 'Content-Type': 'application/x-ndjson' },
    })
  }

  // Non-streaming
  try {
    const data = await chatWithAi(oneMinReq, apiKey)
    const content = fromOneMinAiResponse(data)
    return c.json(toOllamaGenerateResponse(content, model))
  } catch (err: any) {
    const status = err.status || 502
    return c.json({ error: err.message || 'Upstream error' }, status)
  }
})

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`1min.ai relay server running on http://localhost:${info.port}`)
})

export default app
