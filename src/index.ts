import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { config, getModelList } from './config.js'
import { registerOpenAiRoutes } from './openai/routes.js'
import { registerOllamaRoutes } from './ollama/routes.js'
import { registerAnthropicRoutes } from './anthropic/routes.js'

const app = new Hono()

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['*'],
}))

// GET /health
app.get('/health', (c) => c.json({ status: 'ok' }))

registerOpenAiRoutes(app)
registerOllamaRoutes(app)
registerAnthropicRoutes(app)

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
