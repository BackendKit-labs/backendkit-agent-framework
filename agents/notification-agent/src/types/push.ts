export interface PushPayload {
  provider?: "fcm" | "expo" | "onesignal"
  tokens: string[]
  title: string
  body: string
  icon?: string
  image?: string
  sound?: "default" | "critical" | "silent"
  badge?: number
  data?: Record<string, any>
  actions?: { id: string; title: string; action: "open_url" | "deep_link" | "dismiss"; url?: string }[]
  group?: string
  groupSummary?: string
  androidPriority?: "high" | "normal" | "low"
  iosInterruptionLevel?: "active" | "critical" | "passive" | "timeSensitive"
  ttl?: number
  segments?: string[]
}

export interface DeviceRecord {
  id: string
  userId: string
  companyId: string
  provider: "fcm" | "expo" | "onesignal"
  token: string
  platform: "ios" | "android" | "web"
  active: boolean
  lastSeen: string
  registeredAt: string
  deviceInfo?: { osVersion?: string; appVersion?: string; model?: string }
  tags?: Record<string, string>
}
