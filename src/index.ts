import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { config, getModelList } from './config.js'

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

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`1min.ai relay server running on http://localhost:${info.port}`)
})

export default app
