export interface SnippetOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  url: string
  headers?: Record<string, string>
  body?: string
}

export function generateCurl(opts: SnippetOptions): string {
  const parts: string[] = ['curl']
  const method = opts.method.toUpperCase()

  if (method !== 'GET' || opts.body) {
    parts.push(`-X ${method}`)
  }

  parts.push(`"${opts.url}"`)

  if (opts.headers) {
    for (const [key, value] of Object.entries(opts.headers)) {
      if (value) {
        parts.push(`-H "${key}: ${value.replace(/"/g, '\\"')}"`)
      }
    }
  }

  if (opts.body && (method === 'POST' || method === 'PATCH' || method === 'DELETE')) {
    const trimmed = opts.body.trim()
    if (trimmed) {
      // Escape single quotes for shell single-quoted string
      const escaped = trimmed.replace(/'/g, `'\\''`)
      parts.push(`-d '${escaped}'`)
    }
  }

  return parts.join(' \\\n  ')
}

export function generateJavaScript(opts: SnippetOptions): string {
  const method = opts.method.toUpperCase()
  const headersObj = opts.headers || {}
  const hasHeaders = Object.keys(headersObj).length > 0
  const hasBody = Boolean(opts.body?.trim() && (method === 'POST' || method === 'PATCH'))

  let optionsStr = ''
  const lines: string[] = []
  lines.push(`  method: '${method}',`)

  if (hasHeaders) {
    const headerLines = Object.entries(headersObj)
      .filter(([_, v]) => Boolean(v))
      .map(([k, v]) => `    '${k}': '${v.replace(/'/g, "\\'")}',`)
    lines.push(`  headers: {\n${headerLines.join('\n')}\n  },`)
  }

  if (hasBody) {
    try {
      const parsed = JSON.parse(opts.body!)
      const formatted = JSON.stringify(parsed, null, 2)
        .split('\n')
        .map((l, i) => (i === 0 ? l : '  ' + l))
        .join('\n')
      lines.push(`  body: JSON.stringify(${formatted}),`)
    } catch {
      lines.push(`  body: JSON.stringify(${JSON.stringify(opts.body)}),`)
    }
  }

  optionsStr = `{\n${lines.join('\n')}\n}`

  return `// JavaScript (fetch)
async function sendRequest() {
  const response = await fetch('${opts.url}', ${optionsStr});

  if (!response.ok) {
    throw new Error(\`HTTP error! status: \${response.status}\`);
  }

  const data = await response.json();
  console.log(data);
  return data;
}

sendRequest().catch(console.error);`
}

export function generatePython(opts: SnippetOptions): string {
  const method = opts.method.toLowerCase()
  const headersObj = opts.headers || {}
  const hasHeaders = Object.keys(headersObj).length > 0
  const hasBody = Boolean(opts.body?.trim() && (method === 'post' || method === 'patch'))

  const lines: string[] = ['import requests\n']
  lines.push(`url = "${opts.url}"`)

  if (hasHeaders) {
    lines.push('headers = {')
    for (const [k, v] of Object.entries(headersObj)) {
      if (v) {
        lines.push(`    "${k}": "${v.replace(/"/g, '\\"')}",`)
      }
    }
    lines.push('}')
  } else {
    lines.push('headers = {}')
  }

  let callArgs = 'url, headers=headers'

  if (hasBody) {
    try {
      const parsed = JSON.parse(opts.body!)
      const formatted = JSON.stringify(parsed, null, 4)
      lines.push(`payload = ${formatted}`)
      callArgs += ', json=payload'
    } catch {
      lines.push(`data = ${JSON.stringify(opts.body)}`)
      callArgs += ', data=data'
    }
  }

  lines.push(`\nresponse = requests.${method}(${callArgs})`)
  lines.push('print("Status Code:", response.status_code)')
  lines.push('try:')
  lines.push('    print(response.json())')
  lines.push('except Exception:')
  lines.push('    print(response.text)')

  return lines.join('\n')
}

export function generateGo(opts: SnippetOptions): string {
  const method = opts.method.toUpperCase()
  const headersObj = opts.headers || {}
  const hasBody = Boolean(opts.body?.trim() && (method === 'POST' || method === 'PATCH'))

  const imports = ['fmt', 'io', 'net/http']
  if (hasBody) {
    imports.push('strings')
  }

  const lines: string[] = [
    'package main\n',
    'import (',
    ...imports.map((im) => `\t"${im}"`),
    ')\n',
    'func main() {',
    `\turl := "${opts.url}"`,
  ]

  if (hasBody) {
    const rawBody = opts.body!.trim().replace(/`/g, '` + "`" + `')
    lines.push(`\tbody := strings.NewReader(\`${rawBody}\`)`)
    lines.push(`\treq, err := http.NewRequest("${method}", url, body)`)
  } else {
    lines.push(`\treq, err := http.NewRequest("${method}", url, nil)`)
  }

  lines.push('\tif err != nil {')
  lines.push('\t\tpanic(err)')
  lines.push('\t}\n')

  for (const [k, v] of Object.entries(headersObj)) {
    if (v) {
      lines.push(`\treq.Header.Set("${k}", "${v.replace(/"/g, '\\"')}")`)
    }
  }

  lines.push('\n\tresp, err := http.DefaultClient.Do(req)')
  lines.push('\tif err != nil {')
  lines.push('\t\tpanic(err)')
  lines.push('\t}')
  lines.push('\tdefer resp.Body.Close()\n')

  lines.push('\trespBody, err := io.ReadAll(resp.Body)')
  lines.push('\tif err != nil {')
  lines.push('\t\tpanic(err)')
  lines.push('\t}\n')

  lines.push('\tfmt.Println("Status:", resp.StatusCode)')
  lines.push('\tfmt.Println(string(respBody))')
  lines.push('}')

  return lines.join('\n')
}
