import {
  getPiiBadgeInfo,
  formatBytes,
  formatCoverage,
  filterDictionary,
  generateClientMarkdown,
  generateClientOpenAPI,
  type DataDictionary,
} from './dictionaryHelper.ts'

declare const process: { exit: (code: number) => void }

let passed = 0
let failed = 0

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`)
  }
}

function test(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err: any) {
    failed++
    console.error(`  ✗ ${name}: ${err.message}`)
  }
}

console.log('--- Running Data Dictionary Helper Unit Tests ---')

const mockDict: DataDictionary = {
  connectionId: 'prod-postgres',
  dialect: 'postgres',
  database: 'analytics',
  generatedAt: '2026-09-27T10:00:00Z',
  summary: {
    totalSchemas: 2,
    totalTables: 2,
    totalViews: 0,
    totalColumns: 5,
    totalIndexes: 2,
    totalForeignKeys: 1,
    totalPIIColumns: 2,
    documentedColumns: 3,
    documentationCoverage: 60.0,
  },
  schemas: [
    {
      name: 'public',
      tableCount: 1,
      columnCount: 3,
      tables: [
        {
          name: 'users',
          schema: 'public',
          type: 'table',
          comment: 'Primary registered user accounts',
          rowCount: 5000,
          sizeBytes: 2097152,
          sizeFormatted: '2.0 MB',
          piiCount: 2,
          columns: [
            {
              name: 'id',
              type: 'bigint',
              dataType: 'bigint',
              isNullable: false,
              isPrimary: true,
              isForeignKey: false,
              default: null,
              comment: 'Primary account key',
              ordinal: 1,
            },
            {
              name: 'email',
              type: 'varchar(255)',
              dataType: 'varchar',
              isNullable: false,
              isPrimary: false,
              isForeignKey: false,
              default: null,
              comment: 'User email address',
              piiType: 'email',
              ordinal: 2,
            },
            {
              name: 'phone',
              type: 'varchar(50)',
              dataType: 'varchar',
              isNullable: true,
              isPrimary: false,
              isForeignKey: false,
              default: null,
              comment: '',
              piiType: 'phone',
              ordinal: 3,
            },
          ],
          indexes: [
            {
              name: 'users_pkey',
              columns: ['id'],
              isUnique: true,
              isPrimary: true,
              type: 'BTREE',
            },
          ],
          foreignKeys: [],
        },
      ],
    },
    {
      name: 'billing',
      tableCount: 1,
      columnCount: 2,
      tables: [
        {
          name: 'invoices',
          schema: 'billing',
          type: 'table',
          comment: 'Customer monthly billing invoices',
          rowCount: 12000,
          sizeBytes: 8388608,
          sizeFormatted: '8.0 MB',
          piiCount: 0,
          columns: [
            {
              name: 'id',
              type: 'bigint',
              dataType: 'bigint',
              isNullable: false,
              isPrimary: true,
              isForeignKey: false,
              default: null,
              comment: 'Invoice identifier',
              ordinal: 1,
            },
            {
              name: 'user_id',
              type: 'bigint',
              dataType: 'bigint',
              isNullable: false,
              isPrimary: false,
              isForeignKey: true,
              default: null,
              comment: '',
              ordinal: 2,
            },
          ],
          indexes: [
            {
              name: 'invoices_pkey',
              columns: ['id'],
              isUnique: true,
              isPrimary: true,
              type: 'BTREE',
            },
          ],
          foreignKeys: [
            {
              column: 'user_id',
              refTable: 'users',
              refColumn: 'id',
              onUpdate: 'CASCADE',
              onDelete: 'RESTRICT',
            },
          ],
        },
      ],
    },
  ],
}

test('getPiiBadgeInfo: classifies known and fallback PII types', () => {
  const emailBadge = getPiiBadgeInfo('email')
  assert(emailBadge.label === 'EMAIL', 'email label')
  assert(emailBadge.color.includes('rose'), 'email color')

  const cardBadge = getPiiBadgeInfo('card')
  assert(cardBadge.label === 'PCI-CARD', 'card label')

  const phoneBadge = getPiiBadgeInfo('phone')
  assert(phoneBadge.label === 'PHONE', 'phone label')

  const ssnBadge = getPiiBadgeInfo('ssn')
  assert(ssnBadge.label === 'SSN/ID', 'ssn label')

  const fallbackBadge = getPiiBadgeInfo('custom_secret')
  assert(fallbackBadge.label === 'CUSTOM_SECRET', 'fallback uppercase')
})

test('formatBytes: formats raw byte counts accurately', () => {
  assert(formatBytes(0) === '0 B', '0 bytes')
  assert(formatBytes(512) === '512 B', 'sub-KB bytes')
  assert(formatBytes(1024) === '1.0 KB', '1 KB')
  assert(formatBytes(2097152) === '2.0 MB', '2 MB')
  assert(formatBytes(1073741824) === '1.0 GB', '1 GB')
})

test('formatCoverage: formats percentages correctly', () => {
  assert(formatCoverage(0) === '0.0%', '0%')
  assert(formatCoverage(66.666) === '66.7%', '66.7% rounded')
  assert(formatCoverage(100) === '100.0%', '100%')
})

test('filterDictionary: filters by schema, search query, and piiOnly', () => {
  // 1. All
  const all = filterDictionary(mockDict, '', '', false)
  assert(all.length === 2, 'all schemas returned')
  assert(all[0].tables.length === 1 && all[1].tables.length === 1, 'both tables returned')

  // 2. Schema filter
  const billingOnly = filterDictionary(mockDict, 'billing', '', false)
  assert(billingOnly.length === 1, 'only billing schema returned')
  assert(billingOnly[0].name === 'billing', 'name matches billing')

  // 3. PII only filter
  const piiOnly = filterDictionary(mockDict, '', '', true)
  assert(piiOnly.length === 1, 'only 1 schema with PII table')
  assert(piiOnly[0].tables[0].name === 'users', 'users has PII')

  // 4. Search by table name
  const searchUsers = filterDictionary(mockDict, '', 'users', false)
  assert(searchUsers.length === 1 && searchUsers[0].tables[0].name === 'users', 'search users')

  // 5. Search by column name
  const searchEmail = filterDictionary(mockDict, '', 'email', false)
  assert(searchEmail.length === 1 && searchEmail[0].tables[0].name === 'users', 'search email col')

  // 6. Search by comment
  const searchInvoices = filterDictionary(mockDict, '', 'monthly billing', false)
  assert(searchInvoices.length === 1 && searchInvoices[0].tables[0].name === 'invoices', 'search comment')

  // 7. Non-matching query
  const searchNone = filterDictionary(mockDict, '', 'nonexistent_xyz', false)
  assert(searchNone.length === 0, 'no matches')
})

test('generateClientMarkdown: renders complete markdown catalog', () => {
  const md = generateClientMarkdown(mockDict)
  assert(md.includes('# Data Dictionary: prod-postgres'), 'title in md')
  assert(md.includes('## Executive Summary'), 'summary section')
  assert(md.includes('### Table: `users`'), 'users table section')
  assert(md.includes('### Table: `invoices`'), 'invoices table section')
  assert(md.includes('🛡️ `email`'), 'PII tag badge in md')
  assert(md.includes('users_pkey'), 'index in md')
  assert(md.includes('`users(id)`'), 'foreign key in md')

  // Pipe character escaping
  const dictWithPipes: DataDictionary = {
    ...mockDict,
    schemas: [
      {
        ...mockDict.schemas[0],
        tables: [
          {
            ...mockDict.schemas[0].tables[0],
            columns: [
              {
                ...mockDict.schemas[0].tables[0].columns[0],
                comment: 'Pipe | in | comment should be escaped',
              },
            ],
          },
        ],
      },
    ],
  }
  const safeMd = generateClientMarkdown(dictWithPipes)
  assert(
    safeMd.includes('Pipe \\| in \\| comment should be escaped'),
    'pipe characters in column comments must be escaped with backslash'
  )
})

test('generateClientOpenAPI: generates valid OpenAPI 3.0 schema JSON', () => {
  const jsonStr = generateClientOpenAPI(mockDict)
  const parsed = JSON.parse(jsonStr)

  assert(parsed.openapi === '3.0.3', 'openapi version')
  assert(parsed.info && parsed.info.title.includes('prod-postgres'), 'info title')
  assert(parsed.components && parsed.components.schemas, 'components.schemas')

  const userSchema = parsed.components.schemas.users
  assert(userSchema && userSchema.properties, 'user schema properties')
  assert(userSchema.properties.email.format === 'email', 'email format')
  assert(userSchema.properties.id.type === 'integer', 'id integer type')

  const invoiceSchema = parsed.components.schemas.billing_invoices
  assert(invoiceSchema && invoiceSchema.properties, 'billing_invoices schema')
})

console.log(`\nData Dictionary Helper Tests: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exit(1)
}
