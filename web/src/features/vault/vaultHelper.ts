import type {
  ConnectionConfig,
  VaultConnection,
  VaultContainer,
  ConnectionPolicy,
  VaultPolicy,
  DatabaseDriver,
} from '../../lib/api'

/**
 * Validates a team vault container JSON structure.
 */
export function parseVaultContainer(raw: string): {
  valid: boolean
  container?: VaultContainer
  error?: string
} {
  try {
    const trimmed = raw.trim()
    if (!trimmed) {
      return { valid: false, error: 'Vault container cannot be empty' }
    }
    const parsed = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== 'object') {
      return { valid: false, error: 'Vault container must be a valid JSON object' }
    }
    if (parsed.kdf !== 'argon2id') {
      return {
        valid: false,
        error: `Unsupported key derivation function: ${parsed.kdf || 'unknown'}. Expected argon2id`,
      }
    }
    if (!parsed.params || !parsed.params.salt || !parsed.params.memory_kb) {
      return { valid: false, error: 'Missing or invalid Argon2id KDF parameters' }
    }
    if (!parsed.nonce || typeof parsed.nonce !== 'string') {
      return { valid: false, error: 'Missing encryption nonce' }
    }
    if (!parsed.ciphertext || typeof parsed.ciphertext !== 'string') {
      return { valid: false, error: 'Missing encrypted ciphertext payload' }
    }
    if (!parsed.hmac || typeof parsed.hmac !== 'string') {
      return { valid: false, error: 'Missing HMAC integrity verification tag' }
    }

    return {
      valid: true,
      container: parsed as VaultContainer,
    }
  } catch (err: any) {
    return {
      valid: false,
      error: `JSON parse error: ${err?.message || 'Invalid syntax'}`,
    }
  }
}

/**
 * Validates vault passphrase strength.
 */
export function validatePassphrase(passphrase: string): { valid: boolean; error?: string } {
  if (!passphrase || passphrase.trim().length === 0) {
    return { valid: false, error: 'Passphrase cannot be empty' }
  }
  if (passphrase.length < 8) {
    return { valid: false, error: 'Passphrase should be at least 8 characters long for team security' }
  }
  return { valid: true }
}

/**
 * Maps an environment identifier to badge styling.
 */
export function formatVaultEnvironment(env?: string): { label: string; colorClass: string } {
  const norm = (env || 'development').toLowerCase()
  switch (norm) {
    case 'production':
    case 'prod':
      return {
        label: 'Production',
        colorClass: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30',
      }
    case 'staging':
    case 'stage':
      return {
        label: 'Staging',
        colorClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
      }
    case 'test':
    case 'testing':
      return {
        label: 'Test',
        colorClass: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30',
      }
    case 'local':
      return {
        label: 'Local',
        colorClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
      }
    default:
      return {
        label: 'Development',
        colorClass: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30',
      }
  }
}

/**
 * Generates human-readable policy summary strings for a connection.
 */
export function getPolicySummary(
  connPolicy?: ConnectionPolicy,
  vaultPolicy?: VaultPolicy,
  env?: string
): string[] {
  const summaries: string[] = []
  const isProd = (env || '').toLowerCase() === 'production' || (env || '').toLowerCase() === 'prod'

  if (connPolicy?.enforce_read_only) {
    summaries.push('Safe Mode Enforced')
  } else if (vaultPolicy?.global_read_only_prod && isProd) {
    summaries.push('Prod Safe Mode Guardrail')
  }

  if (connPolicy?.require_audit_log) {
    summaries.push('Audit Trail Required')
  } else if (vaultPolicy?.require_audit_all_prod && isProd) {
    summaries.push('Mandatory Prod Audit')
  }

  return summaries
}

/**
 * Converts a UI ConnectionConfig into a VaultConnection.
 */
export function convertConnectionToVaultItem(
  conn: ConnectionConfig,
  policy?: Partial<ConnectionPolicy>
): VaultConnection {
  const isProd = conn.environment === 'production'
  return {
    id: conn.id,
    name: conn.label || conn.name || conn.id,
    driver: (conn.driver || conn.dialect || 'postgres') as DatabaseDriver,
    dsn: conn.dsn,
    environment: conn.environment || (conn.readOnly ? 'production' : 'development'),
    read_only: !!conn.readOnly,
    policy: {
      enforce_read_only: policy?.enforce_read_only ?? (conn.readOnly || isProd),
      require_audit_log: policy?.require_audit_log ?? isProd,
      allowed_roles: policy?.allowed_roles || [],
    },
  }
}

/**
 * Converts a decrypted VaultConnection into a UI ConnectionConfig.
 */
export function convertVaultItemToConnection(vconn: VaultConnection): ConnectionConfig {
  return {
    id: vconn.id || `vault_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    label: vconn.name,
    name: vconn.name,
    driver: vconn.driver as DatabaseDriver,
    dialect: vconn.driver,
    dsn: vconn.dsn,
    environment: (vconn.environment as any) || 'development',
    readOnly: vconn.read_only || vconn.policy?.enforce_read_only || false,
  }
}

/**
 * Triggers a browser file download of .dblens-vault.enc file.
 */
export function downloadEncryptedVaultFile(container: VaultContainer, filename = 'team-vault.dblens-vault.enc') {
  const jsonStr = JSON.stringify(container, null, 2)
  const blob = new Blob([jsonStr], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.dblens-vault.enc') ? filename : `${filename}.dblens-vault.enc`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
