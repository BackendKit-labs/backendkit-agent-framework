export interface UserChannels {
  email?: { address: string; verified: boolean }
  push?: { provider: "fcm" | "expo" | "onesignal"; token: string; platform: "ios" | "android" | "web" }
  telegram?: { chatId: string; username?: string }
  slack?: { webhookUrl: string; channel?: string }
  discord?: { webhookUrl: string }
  whatsapp?: { phone: string }
  in_app?: { enabled: boolean }
}

export interface UserPreferences {
  order: string[]
  quiet_hours?: { start: string; end: string; timezone: string }
  do_not_disturb?: boolean
}

export interface UserData {
  userId: string
  companyId: string
  channels: UserChannels
  preferences: UserPreferences
  devices: string[]
  createdAt: string
  updatedAt: string
}
