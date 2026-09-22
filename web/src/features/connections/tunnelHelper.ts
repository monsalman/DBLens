import type { SSHTunnelConfig, TunnelTestResult, ConnectionConfig } from '../../lib/api'

export function defaultTunnelConfig(): SSHTunnelConfig {
  return {
    enabled: false,
    host: '',
    port: 22,
    user: '',
    auth_method: 'key',
    password: '',
    private_key: '',
    passphrase: '',
  }
}

export function validateTunnelConfig(cfg: Partial<SSHTunnelConfig>): { valid: boolean; errors: string[] } {
  if (!cfg.enabled) {
    return { valid: true, errors: [] }
  }

  const errors: string[] = []

  if (!cfg.host || !cfg.host.trim()) {
    errors.push('SSH bastion host is required')
  }

  const port = cfg.port ?? 22
  if (isNaN(port) || port <= 0 || port > 65535) {
    errors.push('SSH bastion port must be between 1 and 65535')
  }

  if (!cfg.user || !cfg.user.trim()) {
    errors.push('SSH bastion username is required')
  }

  const authMethod = cfg.auth_method || 'key'
  if (authMethod === 'password') {
    if (!cfg.password) {
      errors.push('SSH password is required')
    }
  } else if (authMethod === 'key') {
    if (!cfg.private_key || !cfg.private_key.trim()) {
      errors.push('SSH private key is required')
    }
  } else if (authMethod === 'agent') {
    // Agent uses runtime $SSH_AUTH_SOCK
  } else {
    errors.push(`Unsupported authentication method: ${authMethod}`)
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

export function formatTunnelStatus(res: TunnelTestResult): string {
  if (!res.success) {
    return res.message || 'SSH tunnel connection failed'
  }
  const parts: string[] = []
  if (res.latency_ms !== undefined && res.latency_ms >= 0) {
    parts.push(`${res.latency_ms}ms latency`)
  }
  if (res.banner) {
    parts.push(res.banner)
  }
  if (parts.length > 0) {
    return `Connected (${parts.join(', ')})`
  }
  return res.message || 'Connected successfully'
}

export function hasSSHTunnel(conn?: ConnectionConfig | null): boolean {
  return Boolean(conn && conn.ssh_tunnel && conn.ssh_tunnel.enabled)
}

export function maskTunnelConfig(cfg: SSHTunnelConfig): SSHTunnelConfig {
  return {
    ...cfg,
    password: cfg.password ? '••••••••' : '',
    private_key: cfg.private_key ? '•••• [KEY CONFIGURED] ••••' : '',
    passphrase: cfg.passphrase ? '••••••••' : '',
  }
}
