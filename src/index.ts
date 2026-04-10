import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import { serve } from '@hono/node-server'
import { config, getModelList, resolveModelName, getApiKey } from './config.js'
import { messagesToPrompt, extractImages, extractWebSearch, toOneMinAiRequest, fromOneMinAiResponse, toOpenAiResponse, toOpenAiStreamChunk, toOllamaChatResponse, toOllamaChatStreamChunk, toOllamaGenerateResponse, toOllamaGenerateStreamChunk, responsesInputToPrompt, responsesExtractImages, toResponsesApiResponse, responsesStreamEvents, toAnthropicPrompt, extractAnthropicImages, extractAnthropicDocuments, toAnthropicResponse, anthropicStreamEvents, parseAnthropicResponse, toAnthropicModelList, toAnthropicModelInfo } from './transform.js'
import { chatWithAi, chatWithAiStream, uploadImageAsset, uploadFileAsset } from './oneminai.js'

const app = new Hono()

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['*'],
}))

// Log unmatched /anthropic routes for debugging
app.use('/anthropic/*', async (c, next) => {
  const start = Date.now()
  await next()
  if (c.res.status === 404) {
    console.log(`[unmatched] ${c.req.method} ${c.req.path}`)
  }
})

// GET /health
app.get('/health', (c) => c.json({ status: 'ok' }))

// HEAD /anthropic — health check for Claude Code CLI
app.on('HEAD', '/anthropic', (c) => c.body(null, 200))

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

// GET /anthropic/v1/models — Anthropic model list
app.get('/anthropic/v1/models', (c) => {
  const models = getModelList(config.modelMapping)
  return c.json(toAnthropicModelList(models))
})

// GET /anthropic/v1/models/:model_id — Anthropic model info
app.get('/anthropic/v1/models/:model_id', (c) => {
  const modelId = c.req.param('model_id')
  return c.json(toAnthropicModelInfo(modelId))
})

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
  const rawImages = extractAnthropicImages(body.messages ?? [])
  const rawDocs = extractAnthropicDocuments(body.messages ?? [])
  const [images, files] = await Promise.all([
    Promise.all(
      rawImages.map((img) =>
        img.type === 'url' ? img.url : uploadImageAsset(img.data, img.media_type, apiKey),
      ),
    ),
    Promise.all(
      rawDocs.map((doc) => uploadFileAsset(doc.data, doc.media_type, apiKey)),
    ),
  ])
  const oneMinReq = toOneMinAiRequest({ model, prompt, images, files, webSearch: false })

  // Streaming
  if (body.stream) {
    const hasTools = body.tools && body.tools.length > 0

    return streamSSE(c, async (stream) => {
      const events = anthropicStreamEvents(model)
      let fullText = ''

      try {
        await stream.writeSSE({ event: events.messageStart().event, data: JSON.stringify(events.messageStart().data) })
        await stream.writeSSE({ event: events.ping().event, data: JSON.stringify(events.ping().data) })

        if (hasTools) {
          // When tools are present, buffer everything then parse at the end.
          // Tool call responses can mix text + JSON, so we can't stream incrementally.
          for await (const { event, data } of chatWithAiStream(oneMinReq, apiKey)) {
            if (event === 'content') {
              const parsed = JSON.parse(data)
              fullText += parsed.content
            } else if (event === 'done') {
              const result = parseAnthropicResponse(fullText)
              let blockIndex = 0
              for (const block of result.content) {
                if (block.type === 'text') {
                  await stream.writeSSE({ event: events.contentBlockStart(blockIndex, 'text').event, data: JSON.stringify(events.contentBlockStart(blockIndex, 'text').data) })
                  await stream.writeSSE({ event: events.textDelta(blockIndex, block.text).event, data: JSON.stringify(events.textDelta(blockIndex, block.text).data) })
                  await stream.writeSSE({ event: events.contentBlockStop(blockIndex).event, data: JSON.stringify(events.contentBlockStop(blockIndex).data) })
                } else if (block.type === 'tool_use') {
                  await stream.writeSSE({ event: events.contentBlockStart(blockIndex, 'tool_use', { id: block.id, name: block.name }).event, data: JSON.stringify(events.contentBlockStart(blockIndex, 'tool_use', { id: block.id, name: block.name }).data) })
                  await stream.writeSSE({ event: events.inputJsonDelta(blockIndex, JSON.stringify(block.input)).event, data: JSON.stringify(events.inputJsonDelta(blockIndex, JSON.stringify(block.input)).data) })
                  await stream.writeSSE({ event: events.contentBlockStop(blockIndex).event, data: JSON.stringify(events.contentBlockStop(blockIndex).data) })
                }
                blockIndex++
              }
              await stream.writeSSE({ event: events.messageDelta(result.stop_reason).event, data: JSON.stringify(events.messageDelta(result.stop_reason).data) })
              await stream.writeSSE({ event: events.messageStop().event, data: JSON.stringify(events.messageStop().data) })
            }
          }
        } else {
          // No tools — stream text deltas in real-time
          let started = false
          for await (const { event, data } of chatWithAiStream(oneMinReq, apiKey)) {
            if (event === 'content') {
              const parsed = JSON.parse(data)
              if (!started) {
                started = true
                await stream.writeSSE({ event: events.contentBlockStart(0, 'text').event, data: JSON.stringify(events.contentBlockStart(0, 'text').data) })
              }
              await stream.writeSSE({ event: events.textDelta(0, parsed.content).event, data: JSON.stringify(events.textDelta(0, parsed.content).data) })
            } else if (event === 'done') {
              await stream.writeSSE({ event: events.contentBlockStop(0).event, data: JSON.stringify(events.contentBlockStop(0).data) })
              await stream.writeSSE({ event: events.messageDelta('end_turn').event, data: JSON.stringify(events.messageDelta('end_turn').data) })
              await stream.writeSSE({ event: events.messageStop().event, data: JSON.stringify(events.messageStop().data) })
            }
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

serve({ fetch: app.fetch, port: config.port }, (info) => {
  const models = getModelList(config.modelMapping)
  const aliasCount = Object.keys(config.modelMapping).length

  console.log('')
  console.log('  1min.ai Relay Server')
  console.log('  ────────────────────────────────────────')
  console.log(`  OpenAI:    http://localhost:${info.port}/v1/chat/completions`)
  console.log(`  Ollama:    http://localhost:${info.port}/api/chat`)
  console.log(`  Anthropic: http://localhost:${info.port}/anthropic/v1/messages`)
  console.log(`  Models:  ${models.length} loaded${aliasCount > 0 ? ` (${aliasCount} aliases)` : ''}`)
  console.log(`  API Key: ${config.apiKey ? 'from env ✓' : 'not set (pass via Bearer token)'}`)
  console.log('  ────────────────────────────────────────')
  console.log('')
})

export default app
