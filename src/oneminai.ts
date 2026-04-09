// 1min.ai API client — chat (non-streaming) & SSE streaming

// ── Types ──────────────────────────────────────────────

export interface OneMinAiRequest {
  type: string
  model: string
  promptObject: {
    prompt: string
    attachments?: { images: string[] }
    settings?: { webSearchSettings: { webSearch: boolean } }
  }
}

// ── Constants ─────────────────────────────────────────

const BASE_URL = 'https://api.1min.ai/api/chat-with-ai'

function headers(apiKey: string) {
  return {
    'API-KEY': apiKey,
    'Content-Type': 'application/json',
  }
}

// ── Non-streaming ─────────────────────────────────────

export async function chatWithAi(body: OneMinAiRequest, apiKey: string): Promise<any> {
  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const message = await res.text()
    throw { status: res.status, message }
  }

  return res.json()
}

// ── Streaming (SSE) ───────────────────────────────────

export async function* chatWithAiStream(
  body: OneMinAiRequest,
  apiKey: string,
): AsyncGenerator<{ event: string; data: string }> {
  const res = await fetch(`${BASE_URL}?isStreaming=true`, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const message = await res.text()
    throw { status: res.status, message }
  }

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let currentEvent = ''
  let currentData = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n')
    // Keep the last (possibly incomplete) line in buffer
    buffer = lines.pop()!

    for (const line of lines) {
      if (line.startsWith('event:')) {
        currentEvent = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        currentData = line.slice(5).trim()
      } else if (line === '') {
        // Empty line = SSE delimiter
        if (currentEvent && currentData) {
          yield { event: currentEvent, data: currentData }
          currentEvent = ''
          currentData = ''
        }
      }
    }
  }

  // Flush any remaining buffered data
  if (buffer.trim() !== '') {
    if (buffer.startsWith('event:')) {
      currentEvent = buffer.slice(6).trim()
    } else if (buffer.startsWith('data:')) {
      currentData = buffer.slice(5).trim()
    }
  }
  if (currentEvent && currentData) {
    yield { event: currentEvent, data: currentData }
  }
}
