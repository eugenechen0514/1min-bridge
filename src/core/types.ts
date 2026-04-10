export interface TextContentPart {
  type: 'text'
  text: string
}

export interface ImageUrlContentPart {
  type: 'image_url'
  image_url: { url: string }
}

export type ContentPart = TextContentPart | ImageUrlContentPart

export interface Message {
  role: string
  content: string | ContentPart[]
}

export interface OneMinAiRequestInput {
  model: string
  prompt: string
  images: string[]
  files: string[]
  webSearch: boolean
}

export const ROLE_PREFIX: Record<string, string> = {
  system: '[System]',
  user: '[User]',
  assistant: '[Assistant]',
}
