export interface ChannelResult {
  success: boolean
  status: "sent" | "failed"
  deliveredAt: string
  error?: string
  latencyMs: number
  content?: string  // Para canal director (Markdown)
  tokenExpired?: boolean  // Para detectar tokens push expirados
}

export interface NotificationRecord {
  id: string
  userId?: string
  companyId?: string
  channel: string
  title: string
  body: string
  status: "sent" | "failed"
  createdAt: string
  deliveredAt: string
  error?: string
  retryCount: number
  fallbackUsed: boolean
  source?: string
  context?: any
  attempts: { channel: string; status: string; error?: string }[]
}
