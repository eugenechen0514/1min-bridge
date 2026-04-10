import type { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { config, getModelList, resolveModelName, getApiKey } from '../config.js'
import { toOneMinAiRequest, fromOneMinAiResponse } from '../core/transform.js'
import { toAnthropicPrompt, extractAnthropicImages, extractAnthropicDocuments, toAnthropicResponse, anthropicStreamEvents, parseAnthropicResponse, toAnthropicModelList, toAnthropicModelInfo } from './transform.js'
import { chatWithAi, chatWithAiStream, uploadImageAsset, uploadFileAsset } from '../oneminai.js'

export function registerAnthropicRoutes(app: Hono): void {
  // Log unmatched /anthropic routes for debugging
  app.use('/anthropic/*', async (c, next) => {
    await next()
    if (c.res.status === 404) {
      console.log(`[unmatched] ${c.req.method} ${c.req.path}`)
    }
  })

  // HEAD /anthropic — health check for Claude Code CLI
  app.on('HEAD', '/anthropic', (c) => c.body(null, 200))

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
}
