import type { Hono } from 'hono'
import { config, getModelList, resolveModelName, getApiKey } from '../config.js'
import { messagesToPrompt, extractImages, toOneMinAiRequest, fromOneMinAiResponse } from '../core/transform.js'
import { toOllamaChatResponse, toOllamaChatStreamChunk, toOllamaGenerateResponse, toOllamaGenerateStreamChunk } from './transform.js'
import { chatWithAi, chatWithAiStream } from '../oneminai.js'

export function registerOllamaRoutes(app: Hono): void {
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
    const oneMinReq = toOneMinAiRequest({ model, prompt, images, files: [], webSearch: false })

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
    const oneMinReq = toOneMinAiRequest({ model, prompt, images: [], files: [], webSearch: false })

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
}
