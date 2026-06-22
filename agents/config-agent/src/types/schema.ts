export type FieldType = 'string' | 'number' | 'boolean' | 'secret' | 'select' | 'url'

export interface FieldSchema {
  type: FieldType
  required: boolean
  default?: any
  description?: string
  placeholder?: string
  min?: number
  max?: number
  options?: string[]
  pattern?: string
  secret: boolean
}

export interface ConfigSchema {
  fields: Record<string, FieldSchema>
  groups?: { title: string; fields: string[] }[]
}
