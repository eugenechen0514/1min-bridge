export function toOllamaChatResponse(content: string, model: string) {
  return {
    model,
    created_at: new Date().toISOString(),
    message: { role: 'assistant' as const, content },
    done: true as const,
  }
}

export function toOllamaChatStreamChunk(content: string, model: string, done: boolean) {
  return {
    model,
    created_at: new Date().toISOString(),
    message: { role: 'assistant' as const, content },
    done,
  }
}

export function toOllamaGenerateResponse(content: string, model: string) {
  return {
    model,
    created_at: new Date().toISOString(),
    response: content,
    done: true as const,
  }
}

export function toOllamaGenerateStreamChunk(content: string, model: string, done: boolean) {
  return {
    model,
    created_at: new Date().toISOString(),
    response: content,
    done,
  }
}
