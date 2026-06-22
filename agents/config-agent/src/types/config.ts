export interface ConfigValue {
  value: any
  type: 'config' | 'secret'
  updatedAt: string
  updatedInVersion: string
  validated: boolean
}

export interface ConfigEntry {
  agent_id: string
  key: string
  value: any
  message?: string
}
