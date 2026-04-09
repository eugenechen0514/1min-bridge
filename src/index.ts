import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { config, getModelList, resolveModelName, getApiKey } from './config.js'
import { messagesToPrompt, extractImages, extractWebSearch, toOneMinAiRequest, fromOneMinAiResponse, toOpenAiResponse } from './transform.js'
import { chatWithAi } from './oneminai.js'

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

  // 5. Handle non-streaming only (streaming will be added in Task 7)
  if (body.stream) {
    // Placeholder — will be implemented in Task 7
    return c.json({ error: { message: 'Streaming not yet implemented', type: 'server_error' } }, 501)
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

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`1min.ai relay server running on http://localhost:${info.port}`)
})

export default app
