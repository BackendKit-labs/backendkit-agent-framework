export interface SendEmailParams {
  to: string | string[]
  subject?: string
  body: string
  priority?: "low" | "normal" | "high" | "critical"
  attachments?: { filename: string; content: string; contentType: string }[]
}

export interface SendSlackParams {
  webhookUrl: string
  channel?: string
  body: string
  priority?: "low" | "normal" | "high" | "critical"
}

export interface SendTelegramParams {
  chatId: string
  body: string
  parseMode?: "Markdown" | "HTML"
}

export interface SendDiscordParams {
  webhookUrl: string
  body: string
  priority?: "low" | "normal" | "high" | "critical"
}

export interface SendWebhookParams {
  url: string
  body: string
  headers?: Record<string, string>
}

export interface SendConsoleParams {
  body: string
  priority?: "low" | "normal" | "high" | "critical"
}

export interface SendDirectorParams {
  body: string
  priority?: "low" | "normal" | "high" | "critical"
}
