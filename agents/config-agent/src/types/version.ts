export interface VersionChange {
  key: string
  action: 'added' | 'removed' | 'updated'
  previousVersion?: string
}

export interface ConfigVersion {
  version: string
  createdAt: string
  message: string
  agent_id: string
  config: Record<string, any>
  changes: VersionChange[]
  checksum: string
}
