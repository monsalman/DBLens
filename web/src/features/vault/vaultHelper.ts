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
 * Sanitizes passwords from connection strings, replacing them with an env variable placeholder.
 */
export function scrubDSN(rawDSN: string, placeholderVar = '$DATABASE_PASSWORD'): { dsn: string; scrubbed: boolean } {
  const raw = (rawDSN || '').trim()
  if (!raw) return { dsn: raw, scrubbed: false }

  const placeholder = placeholderVar.startsWith('$') ? placeholderVar : `$${placeholderVar}`

  // 1. URI style (scheme://user:pass@host/db)
  const schemeIdx = raw.indexOf('://')
  if (schemeIdx !== -1) {
    const scheme = raw.slice(0, schemeIdx + 3)
    const rest = raw.slice(schemeIdx + 3)

    const qIdx = rest.indexOf('?')
    const base = qIdx !== -1 ? rest.slice(0, qIdx) : rest
    const lastAt = base.lastIndexOf('@')

    if (lastAt !== -1) {
      const userInfo = rest.slice(0, lastAt)
      const hostAndPath = rest.slice(lastAt + 1)

      let host = hostAndPath
      let pathAndQuery = ''
      const slashIdx = hostAndPath.indexOf('/')
      if (slashIdx !== -1) {
        host = hostAndPath.slice(0, slashIdx)
        pathAndQuery = hostAndPath.slice(slashIdx)
      } else {
        const queryIdx = hostAndPath.indexOf('?')
        if (queryIdx !== -1) {
          host = hostAndPath.slice(0, queryIdx)
          pathAndQuery = hostAndPath.slice(queryIdx)
        }
      }

      const firstColon = userInfo.indexOf(':')
      if (firstColon !== -1) {
        const user = userInfo.slice(0, firstColon)
        const pass = userInfo.slice(firstColon + 1)
        if (pass.startsWith('$') || pass.startsWith('op://') || pass.startsWith('pass:')) {
          return { dsn: raw, scrubbed: false }
        }
        return {
          dsn: `${scheme}${user}:${placeholder}@${host}${pathAndQuery}`,
          scrubbed: true,
        }
      }
    }
  }

  // 2. Key-value format (password=secret or pwd=secret)
  const kvRegex = /\b(password|pwd)\s*=\s*('[^']*'|"[^"]*"|[^\s;]+)/i
  const kvMatch = kvRegex.exec(raw)
  if (kvMatch) {
    const fullMatch = kvMatch[0]
    const key = kvMatch[1]
    const valWithQuotes = kvMatch[2]
    const cleanVal = valWithQuotes.replace(/^['"]|['"]$/g, '')
    if (cleanVal && !cleanVal.startsWith('$') && !cleanVal.startsWith('op://') && !cleanVal.startsWith('pass:')) {
      const keyIndex = raw.indexOf(fullMatch)
      const prefix = raw.slice(0, keyIndex)
      const suffix = raw.slice(keyIndex + fullMatch.length)
      return {
        dsn: `${prefix}${key}=${placeholder}${suffix}`,
        scrubbed: true,
      }
    }
  }

  // 3. MySQL bare DSN (user:pass@tcp(...), user:pass@/db, user:pass@host:port/db)
  if (raw.includes('@') && !raw.includes('://')) {
    const lastAt = raw.lastIndexOf('@')
    const userInfo = raw.slice(0, lastAt)
    const rest = raw.slice(lastAt + 1)
    const firstColon = userInfo.indexOf(':')
    if (firstColon !== -1 && !userInfo.includes('=')) {
      const user = userInfo.slice(0, firstColon)
      const pass = userInfo.slice(firstColon + 1)
      if (pass.startsWith('$') || pass.startsWith('op://') || pass.startsWith('pass:')) {
        return { dsn: raw, scrubbed: false }
      }
      return {
        dsn: `${user}:${placeholder}@${rest}`,
        scrubbed: true,
      }
    }
  }

  return { dsn: raw, scrubbed: false }
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
