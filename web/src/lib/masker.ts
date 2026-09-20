export type MaskStrategy = 'partial' | 'redact' | 'hash' | 'faker'

export type PIIType =
  | 'email'
  | 'phone'
  | 'card'
  | 'ssn'
  | 'password'
  | 'name'
  | 'address'
  | 'ip'
  | ''

const RFC5322_EMAIL =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/

const SSN_REGEX = /^\d{3}-\d{2}-\d{4}$/
const PHONE_CHARS = /^\+?[0-9\s\-().]{7,25}$/
const IPV4_REGEX = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/

const FAKER_FIRST_NAMES = [
  'James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda',
  'William', 'Elizabeth', 'David', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica',
  'Thomas', 'Sarah', 'Charles', 'Karen', 'Christopher', 'Nancy', 'Daniel', 'Lisa',
  'Matthew', 'Betty', 'Anthony', 'Margaret', 'Mark', 'Sandra',
]

const FAKER_LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
  'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin',
]

const FAKER_USERNAMES = [
  'alex', 'jordan', 'taylor', 'morgan', 'sam', 'chris', 'pat', 'casey',
  'riley', 'jamie', 'cameron', 'dakota', 'avery', 'reese', 'quinn',
]

const FAKER_DOMAINS = [
  'example.com', 'example.org', 'sample.net', 'testmail.com', 'mockdata.io',
]

const FAKER_STREETS = [
  'Oak St', 'Maple Ave', 'Pine St', 'Cedar Ln', 'Elm St', 'Washington Blvd', 'Main St', 'Lakeview Dr',
]

const FAKER_CITIES = [
  'Springfield', 'Riverdale', 'Franklin', 'Clinton', 'Georgetown', 'Madison', 'Salem', 'Fairview',
]

const FAKER_STATES = ['IL', 'CA', 'NY', 'TX', 'WA', 'OH', 'FL', 'PA']

export function isLuhnValid(s: string): boolean {
  const clean = s.replace(/[\s-]/g, '')
  if (!/^\d{13,19}$/.test(clean)) return false

  let sum = 0
  let alternate = false
  for (let i = clean.length - 1; i >= 0; i--) {
    let digit = parseInt(clean.charAt(i), 10)
    if (alternate) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
    alternate = !alternate
  }
  return sum % 10 === 0
}

function isIP(s: string): boolean {
  const str = s.trim()
  if (!str) return false
  if (IPV4_REGEX.test(str)) return true
  // basic IPv6 check
  return str.includes(':') && /^[0-9a-fA-F:]+$/.test(str)
}

function isPhone(s: string): boolean {
  const str = s.trim()
  if (str.length < 7 || str.length > 25) return false
  // Exclude ISO dates (e.g. 2026-01-01) and timestamps
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(str)) return false
  if (!PHONE_CHARS.test(str)) return false
  const digits = str.replace(/\D/g, '').length
  return digits >= 7 && digits <= 15
}

function detectColumnPII(colName: string): PIIType {
  const norm = colName.toLowerCase().trim().replace(/[-\s]/g, '_')

  if (norm.includes('email') || norm.includes('e_mail') || norm.includes('mail_addr')) {
    return 'email'
  }

  if (
    norm.includes('phone') ||
    norm.includes('mobile') ||
    norm.includes('telephone') ||
    norm.includes('tel_no') ||
    norm.includes('cellphone') ||
    norm.includes('cell_no') ||
    norm.includes('msisdn') ||
    norm === 'tel' ||
    norm === 'cell'
  ) {
    return 'phone'
  }

  if (
    norm.includes('card_no') ||
    norm.includes('card_num') ||
    norm.includes('card_number') ||
    norm.includes('credit_card') ||
    norm.includes('debit_card') ||
    norm.includes('cc_num') ||
    norm.includes('pan') ||
    norm.includes('cvv') ||
    norm.includes('cvc') ||
    norm === 'card' ||
    norm === 'cc'
  ) {
    return 'card'
  }

  if (
    norm.includes('ssn') ||
    norm.includes('social_security') ||
    norm.includes('national_id') ||
    norm.includes('nik') ||
    norm.includes('passport') ||
    norm.includes('tax_id') ||
    norm.includes('gov_id')
  ) {
    return 'ssn'
  }

  if (
    norm.includes('password') ||
    norm.includes('passwd') ||
    norm.includes('secret') ||
    norm.includes('api_key') ||
    norm.includes('apikey') ||
    norm.includes('access_token') ||
    norm.includes('auth_token') ||
    norm.includes('token') ||
    norm.includes('private_key')
  ) {
    return 'password'
  }

  if (
    norm.includes('ip_address') ||
    norm.includes('ip_addr') ||
    norm.includes('client_ip') ||
    norm.includes('remote_ip') ||
    norm.includes('user_ip') ||
    norm === 'ip' ||
    norm === 'ipv4' ||
    norm === 'ipv6'
  ) {
    return 'ip'
  }

  if (
    norm.includes('address') ||
    norm.includes('street') ||
    norm.includes('zipcode') ||
    norm.includes('zip_code') ||
    norm.includes('postal_code') ||
    norm.includes('postcode') ||
    norm === 'zip' ||
    norm === 'city' ||
    norm === 'state' ||
    norm === 'country' ||
    norm === 'addr'
  ) {
    return 'address'
  }

  if (
    norm === 'name' ||
    norm === 'fullname' ||
    norm === 'full_name' ||
    norm === 'firstname' ||
    norm === 'first_name' ||
    norm === 'lastname' ||
    norm === 'last_name' ||
    norm === 'surname' ||
    norm === 'forename' ||
    norm === 'username' ||
    norm === 'user_name' ||
    norm === 'customer_name' ||
    norm === 'client_name' ||
    norm === 'contact_name' ||
    norm === 'patient_name' ||
    norm === 'owner_name' ||
    norm === 'display_name'
  ) {
    return 'name'
  }

  if (norm.endsWith('_name')) {
    const technical = [
      'table', 'column', 'file', 'class', 'db', 'database', 'schema',
      'host', 'index', 'metric', 'type', 'attr', 'var', 'field',
      'component', 'module', 'domain', 'key', 'package', 'dir',
    ]
    const prefix = norm.slice(0, -5)
    if (!technical.includes(prefix)) {
      return 'name'
    }
  }

  return ''
}

export function detectPIIType(colName: string, sampleValue?: string): PIIType {
  const raw = sampleValue ?? ''
  const val = raw.trim()
  const checkValue = raw.length > 0 && raw.length <= 256

  if (checkValue && val) {
    if (RFC5322_EMAIL.test(val)) return 'email'
    if (isLuhnValid(val)) return 'card'
    if (SSN_REGEX.test(val)) return 'ssn'
    if (isIP(val)) return 'ip'
  }

  const colPII = detectColumnPII(colName)
  if (colPII) return colPII

  if (checkValue && val && isPhone(val)) return 'phone'

  return ''
}

// 32-bit FNV-1a hash producing uint32
function fnv1a(str: string): number {
  let hash = 2166136261
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function generateDeterministicCard(seed: number): string {
  const digits15 = '4532' + String(seed % 100000000000).padStart(11, '0')
  let sum = 0
  for (let i = 0; i < 15; i++) {
    let d = parseInt(digits15[i], 10)
    if (i % 2 === 0) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  const checkDigit = (10 - (sum % 10)) % 10
  const full = digits15 + checkDigit
  return `${full.slice(0, 4)} ${full.slice(4, 8)} ${full.slice(8, 12)} ${full.slice(12, 16)}`
}

function maskPartial(piiType: PIIType, val: string): string {
  switch (piiType) {
    case 'email': {
      const parts = val.split('@')
      if (parts.length !== 2) {
        return val.length <= 2 ? '***' : `${val[0]}***`
      }
      const local = parts[0]
      const domain = parts[1]
      return local.length <= 1 ? `${local}***@${domain}` : `${local[0]}***@${domain}`
    }

    case 'card': {
      const digits = val.replace(/\D/g, '')
      if (digits.length >= 4) {
        return `•••• •••• •••• ${digits.slice(-4)}`
      }
      return '•••• •••• •••• ••••'
    }

    case 'phone': {
      const digits = val.replace(/\D/g, '')
      const hasPlus = val.trim().startsWith('+')
      if (digits.length >= 4) {
        const last4 = digits.slice(-4)
        return hasPlus ? `+1 ••• ••• ${last4}` : `••• ••• ${last4}`
      }
      return '+1 ••• ••• ••••'
    }

    case 'ssn': {
      const digits = val.replace(/\D/g, '')
      if (digits.length >= 4) {
        return `•••-••-${digits.slice(-4)}`
      }
      return '•••-••-••••'
    }

    case 'password':
      return '••••••••'

    case 'ip': {
      if (val.includes('.')) {
        const parts = val.split('.')
        if (parts.length >= 2) return `${parts[0]}.${parts[1]}.•••.•••`
      }
      if (val.includes(':')) {
        const parts = val.split(':')
        if (parts.length > 0) return `${parts[0]}:••••:••••:••••`
      }
      return '•••.•••.•••.•••'
    }

    case 'name': {
      const words = val.trim().split(/\s+/)
      if (words.length === 0 || !words[0]) return '***'
      return words
        .map((w) => {
          if (w.length <= 1) return `${w}*`
          if (w.length === 2) return `${w[0]}*`
          return `${w[0]}***${w[w.length - 1]}`
        })
        .join(' ')
    }

    case 'address': {
      const words = val.trim().split(/\s+/)
      if (words.length > 1) return `${words[0]} ••• [REDACTED]`
      return '••• [REDACTED]'
    }

    default:
      if (val.length <= 2) return '*'.repeat(val.length)
      return `${val[0]}***${val[val.length - 1]}`
  }
}

function maskFaker(piiType: PIIType, val: string): string {
  const seed = fnv1a(`dblens_faker_${val}`)
  const seed2 = fnv1a(`dblens_faker2_${val}`)

  switch (piiType) {
    case 'name': {
      const fn = FAKER_FIRST_NAMES[seed % FAKER_FIRST_NAMES.length]
      const ln = FAKER_LAST_NAMES[seed2 % FAKER_LAST_NAMES.length]
      return `${fn} ${ln}`
    }

    case 'email': {
      const un = FAKER_USERNAMES[seed % FAKER_USERNAMES.length]
      const num = (seed >>> 8) % 900 + 100
      const dom = FAKER_DOMAINS[(seed >>> 16) % FAKER_DOMAINS.length]
      return `${un}${num}@${dom}`
    }

    case 'phone': {
      const num = String(seed % 10000).padStart(4, '0')
      return `+1-555-${num}`
    }

    case 'card':
      return generateDeterministicCard(seed)

    case 'ssn': {
      const p1 = String((seed % 90) + 10).padStart(2, '0')
      const p2 = String(((seed >>> 8) % 90) + 10).padStart(2, '0')
      const p3 = String(((seed >>> 16) % 9000) + 1000).padStart(4, '0')
      return `9${p1}-${p2}-${p3}`
    }

    case 'address': {
      const num = (seed % 900) + 100
      const st = FAKER_STREETS[(seed >>> 8) % FAKER_STREETS.length]
      const city = FAKER_CITIES[(seed >>> 16) % FAKER_CITIES.length]
      const state = FAKER_STATES[(seed >>> 24) % FAKER_STATES.length]
      const zip = String(((seed2 >>> 8) % 90000) + 10000).padStart(5, '0')
      return `${num} ${st}, ${city}, ${state} ${zip}`
    }

    case 'ip': {
      const octet = (seed % 250) + 1
      return `192.0.2.${octet}`
    }

    case 'password':
      return `tok_${(seed >>> 0).toString(16).padStart(8, '0')}`

    default:
      return `synthetic_${(seed >>> 0).toString(16).padStart(8, '0')}`
  }
}

// ponytail: client-side faker uses embedded static wordlists; upgrade to dynamic faker API if custom locales requested.
export function maskValue(
  colName: string,
  val: any,
  strategy: MaskStrategy = 'partial'
): any {
  if (val === null || val === undefined) return val
  const str = String(val)
  if (!str) return val

  const piiType = detectPIIType(colName, str)
  if (!piiType) return val

  switch (strategy) {
    case 'redact':
      return '[REDACTED]'

    case 'hash': {
      const h1 = fnv1a(`dblens_salt_${str}`).toString(16).padStart(8, '0')
      const h2 = fnv1a(`dblens_salt2_${str}`).toString(16).padStart(8, '0')
      return `hash_${h1}${h2}`
    }

    case 'faker':
      return maskFaker(piiType, str)

    case 'partial':
    default:
      return maskPartial(piiType, str)
  }
}

export function maskRecord(
  cols: string[],
  record: string[],
  strategy: MaskStrategy = 'partial'
): string[] {
  return record.map((val, i) => {
    if (!val) return val
    const col = cols[i] || ''
    const pii = detectPIIType(col, val)
    if (!pii) return val
    return String(maskValue(col, val, strategy))
  })
}
