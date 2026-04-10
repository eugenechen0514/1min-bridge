import type { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { config, getModelList, resolveModelName, getApiKey } from '../config.js'
import { messagesToPrompt, extractImages, extractWebSearch, toOneMinAiRequest, fromOneMinAiResponse } from '../core/transform.js'
import { toOpenAiResponse, toOpenAiStreamChunk, responsesInputToPrompt, responsesExtractImages, toResponsesApiResponse, responsesStreamEvents } from './transform.js'
import { chatWithAi, chatWithAiStream } from '../oneminai.js'

export function registerOpenAiRoutes(app: Hono): void {
  // GET /v1/models — OpenAI format
  app.get('/v1/models', (c) => {
    const models = getModelList(config.modelMapping)
    return c.json({
      object: 'list',
      data: models,
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
    const oneMinReq = toOneMinAiRequest({ model, prompt, images, files: [], webSearch })

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

  // POST /v1/responses — OpenAI Responses API
  app.post('/v1/responses', async (c) => {
    const body = await c.req.json()

    const authHeader = c.req.header('Authorization')
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined
    const apiKey = getApiKey(bearerToken, config.apiKey)

    if (!apiKey) {
      return c.json({ error: { message: 'API key is required', type: 'invalid_request_error', code: 'missing_api_key' } }, 401)
    }

    const model = resolveModelName(body.model, config.modelMapping)
    const prompt = responsesInputToPrompt(body.input, body.instructions)
    const images = responsesExtractImages(body.input)
    const webSearch = body.tools?.some((t: any) => t.type === 'web_search') ?? false
    const oneMinReq = toOneMinAiRequest({ model, prompt, images, files: [], webSearch })

    // Streaming
    if (body.stream) {
      return streamSSE(c, async (stream) => {
        const events = responsesStreamEvents(model)
        let fullText = ''

        try {
          await stream.writeSSE({ event: events.created().event, data: JSON.stringify(events.created().data) })
          await stream.writeSSE({ event: events.outputItemAdded().event, data: JSON.stringify(events.outputItemAdded().data) })
          await stream.writeSSE({ event: events.contentPartAdded().event, data: JSON.stringify(events.contentPartAdded().data) })

          for await (const { event, data } of chatWithAiStream(oneMinReq, apiKey)) {
            if (event === 'content') {
              const parsed = JSON.parse(data)
              fullText += parsed.content
              await stream.writeSSE({ event: events.textDelta(parsed.content).event, data: JSON.stringify(events.textDelta(parsed.content).data) })
            } else if (event === 'done') {
              await stream.writeSSE({ event: events.textDone(fullText).event, data: JSON.stringify(events.textDone(fullText).data) })
              await stream.writeSSE({ event: events.contentPartDone(fullText).event, data: JSON.stringify(events.contentPartDone(fullText).data) })
              await stream.writeSSE({ event: events.outputItemDone(fullText).event, data: JSON.stringify(events.outputItemDone(fullText).data) })
              await stream.writeSSE({ event: events.completed(fullText).event, data: JSON.stringify(events.completed(fullText).data) })
            }
          }
        } catch (err: any) {
          await stream.writeSSE({
            event: 'response.failed',
            data: JSON.stringify({ error: { message: err.message || 'Upstream error', code: String(err.status || 502) } }),
          })
        }
      })
    }

    // Non-streaming
    try {
      const data = await chatWithAi(oneMinReq, apiKey)
      const content = fromOneMinAiResponse(data)
      return c.json(toResponsesApiResponse(content, model))
    } catch (err: any) {
      const status = err.status || 502
      const message = err.message || 'Upstream error'
      return c.json({ error: { message, type: 'upstream_error', code: String(status) } }, status)
    }
  })
}
