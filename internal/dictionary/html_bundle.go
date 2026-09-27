package dictionary

const HTMLBundleTemplate = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Data Dictionary - {{.ConnectionID}} (DBLens)</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --card-hover: #334155;
      --border: #334155;
      --text: #f8fafc;
      --muted: #94a3b8;
      --accent: #38bdf8;
      --accent-hover: #0284c7;
      --badge-bg: #0369a1;
      --badge-text: #e0f2fe;
      --pii-bg: #450a0a;
      --pii-border: #dc2626;
      --pii-text: #fecaca;
      --pk-bg: #451a03;
      --pk-border: #d97706;
      --pk-text: #fef3c7;
      --fk-bg: #3b0764;
      --fk-border: #9333ea;
      --fk-text: #f3e8ff;
      --success-bg: #064e3b;
      --success-text: #a7f3d0;
      --table-header: #1e293b;
      --table-alt: #162032;
    }

    [data-theme="light"] {
      --bg: #f8fafc;
      --card-bg: #ffffff;
      --card-hover: #f1f5f9;
      --border: #e2e8f0;
      --text: #0f172a;
      --muted: #64748b;
      --accent: #0284c7;
      --accent-hover: #0369a1;
      --badge-bg: #e0f2fe;
      --badge-text: #0369a1;
      --pii-bg: #fee2e2;
      --pii-border: #f87171;
      --pii-text: #991b1b;
      --pk-bg: #fef3c7;
      --pk-border: #f59e0b;
      --pk-text: #92400e;
      --fk-bg: #f3e8ff;
      --fk-border: #c084fc;
      --fk-text: #6b21a8;
      --success-bg: #d1fae5;
      --success-text: #065f46;
      --table-header: #f1f5f9;
      --table-alt: #f8fafc;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 24px;
      transition: background-color 0.2s, color 0.2s;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
    }

    /* Compliance Banner */
    .compliance-banner {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-left: 4px solid var(--accent);
      border-radius: 8px;
      padding: 16px 20px;
      margin-bottom: 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
    }

    .compliance-info h1 {
      font-size: 1.35rem;
      font-weight: 700;
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .compliance-meta {
      font-size: 0.82rem;
      color: var(--muted);
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
    }

    .compliance-badges {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    .badge-soc2 { background: var(--badge-bg); color: var(--badge-text); border: 1px solid var(--accent); }
    .badge-pii { background: var(--pii-bg); color: var(--pii-text); border: 1px solid var(--pii-border); }
    .badge-pk { background: var(--pk-bg); color: var(--pk-text); border: 1px solid var(--pk-border); }
    .badge-fk { background: var(--fk-bg); color: var(--fk-text); border: 1px solid var(--fk-border); }
    .badge-success { background: var(--success-bg); color: var(--success-text); }

    /* Summary Stats Cards */
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }

    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px 16px;
    }

    .stat-label {
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--muted);
      margin-bottom: 4px;
    }

    .stat-value {
      font-size: 1.45rem;
      font-weight: 700;
      color: var(--text);
    }

    .progress-bar-container {
      width: 100%;
      height: 6px;
      background: var(--border);
      border-radius: 3px;
      margin-top: 8px;
      overflow: hidden;
    }

    .progress-bar {
      height: 100%;
      background: var(--accent);
      border-radius: 3px;
    }

    /* Filter & Controls Bar */
    .filter-bar {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 24px;
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
      justify-content: space-between;
    }

    .filter-group {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      flex: 1;
    }

    .search-input {
      background: var(--bg);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 7px 12px;
      font-size: 0.85rem;
      min-width: 260px;
      outline: none;
    }

    .search-input:focus {
      border-color: var(--accent);
    }

    .select-dropdown {
      background: var(--bg);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 7px 12px;
      font-size: 0.85rem;
      outline: none;
    }

    .checkbox-label {
      font-size: 0.85rem;
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      user-select: none;
    }

    .btn-action {
      background: var(--card-hover);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 7px 12px;
      font-size: 0.82rem;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: background 0.15s;
    }

    .btn-action:hover {
      background: var(--accent);
      color: #fff;
    }

    /* Tables Listing */
    .table-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      margin-bottom: 20px;
      overflow: hidden;
      transition: border-color 0.2s;
    }

    .table-header {
      padding: 14px 18px;
      background: var(--card-hover);
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
      user-select: none;
      border-bottom: 1px solid var(--border);
    }

    .table-title {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .table-name {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 1.05rem;
      font-weight: 700;
      color: var(--text);
    }

    .table-stats {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 0.82rem;
      color: var(--muted);
    }

    .table-body {
      padding: 16px 18px;
    }

    .table-comment-banner {
      font-size: 0.88rem;
      color: var(--text);
      background: var(--bg);
      padding: 10px 14px;
      border-radius: 6px;
      margin-bottom: 16px;
      border-left: 3px solid var(--border);
    }

    /* Columns Data Table */
    .data-table-container {
      overflow-x: auto;
      margin-bottom: 16px;
    }

    table.columns-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.82rem;
      text-align: left;
    }

    table.columns-table th {
      background: var(--table-header);
      color: var(--muted);
      text-transform: uppercase;
      font-size: 0.72rem;
      letter-spacing: 0.05em;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border);
    }

    table.columns-table td {
      padding: 9px 12px;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
    }

    table.columns-table tr:nth-child(even) {
      background: var(--table-alt);
    }

    .col-name {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .col-type {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      color: var(--accent);
    }

    .col-desc {
      color: var(--text);
    }

    .col-empty-desc {
      color: var(--muted);
      font-style: italic;
    }

    /* Indexes & FK Sub-Sections */
    .sub-section {
      margin-top: 14px;
      padding-top: 12px;
      border-top: 1px dashed var(--border);
      font-size: 0.82rem;
    }

    .sub-section-title {
      font-weight: 600;
      color: var(--muted);
      text-transform: uppercase;
      font-size: 0.72rem;
      letter-spacing: 0.05em;
      margin-bottom: 8px;
    }

    .chip-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .chip {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 4px 8px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.75rem;
    }

    /* Print Styles */
    @media print {
      body {
        background: #ffffff !important;
        color: #000000 !important;
        padding: 0 !important;
      }
      .filter-bar, #themeBtn, #printBtn, #toggleAllBtn {
        display: none !important;
      }
      .compliance-banner, .stat-card, .table-card {
        border-color: #cbd5e1 !important;
        background: #ffffff !important;
        color: #000000 !important;
        page-break-inside: avoid;
        box-shadow: none !important;
      }
      .table-header {
        background: #f8fafc !important;
        color: #000000 !important;
      }
      .table-body {
        display: block !important;
      }
      table.columns-table th {
        background: #f1f5f9 !important;
        color: #334155 !important;
      }
      table.columns-table tr:nth-child(even) {
        background: #f8fafc !important;
      }
      .badge-soc2, .badge-pk, .badge-pii, .badge-fk {
        border: 1px solid #94a3b8 !important;
        color: #000000 !important;
        background: #f1f5f9 !important;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Compliance & Header Banner -->
    <div class="compliance-banner">
      <div class="compliance-info">
        <h1>
          <span>📚 Data Dictionary & Schema Documentation</span>
        </h1>
        <div class="compliance-meta">
          <span><strong>Connection:</strong> {{.ConnectionID}}</span>
          <span><strong>Dialect:</strong> {{.Dialect}}</span>
          <span><strong>Generated:</strong> {{.GeneratedAt.Format "2006-01-02 15:04:05 UTC"}}</span>
        </div>
      </div>
      <div class="compliance-badges">
        <span class="badge badge-soc2">SOC 2 TYPE II AUDIT READY</span>
        <span class="badge badge-soc2">HIPAA SECURITY INVENTORY</span>
        <span class="badge badge-soc2">GDPR ART. 30 ROPA</span>
      </div>
    </div>

    <!-- Summary KPIs -->
    <div class="summary-grid">
      <div class="stat-card">
        <div class="stat-label">Total Schemas</div>
        <div class="stat-value">{{.Summary.TotalSchemas}}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Tables</div>
        <div class="stat-value">{{.Summary.TotalTables}}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Columns</div>
        <div class="stat-value">{{.Summary.TotalColumns}}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Documented Columns</div>
        <div class="stat-value">{{.Summary.DocumentedColumns}}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Documentation Coverage</div>
        <div class="stat-value">{{printf "%.1f" .Summary.DocumentationCoverage}}%</div>
        <div class="progress-bar-container">
          <div class="progress-bar" style="width: {{.Summary.DocumentationCoverage}}%"></div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-label">PII Classifications</div>
        <div class="stat-value" style="color: {{if gt .Summary.TotalPIIColumns 0}}#f87171{{else}}var(--text){{end}};">
          {{.Summary.TotalPIIColumns}}
        </div>
      </div>
    </div>

    <!-- Filter & Controls Bar -->
    <div class="filter-bar">
      <div class="filter-group">
        <input type="text" id="searchInput" class="search-input" placeholder="Search tables, columns, types, comments, PII...">
        <select id="schemaSelect" class="select-dropdown">
          <option value="">All Schemas ({{.Summary.TotalSchemas}})</option>
          {{range .Schemas}}
          <option value="{{.Name}}">{{.Name}} ({{.TableCount}} tables)</option>
          {{end}}
        </select>
        <label class="checkbox-label">
          <input type="checkbox" id="piiToggle">
          <span>Show PII Only ({{.Summary.TotalPIIColumns}})</span>
        </label>
      </div>
      <div style="display: flex; gap: 8px;">
        <button id="toggleAllBtn" class="btn-action">Toggle All</button>
        <button id="themeBtn" class="btn-action">🌓 Theme</button>
        <button id="printBtn" class="btn-action" onclick="window.print()">🖨️ Print / PDF</button>
      </div>
    </div>

    <!-- Schemas & Tables -->
    <div id="dictionaryList">
      {{range .Schemas}}
      {{$schema := .}}
      {{range .Tables}}
      <div class="table-card"
           data-schema="{{$schema.Name}}"
           data-table="{{.Name}}"
           data-type="{{.Type}}"
           data-has-pii="{{if gt .PIICount 0}}true{{else}}false{{end}}">
        <div class="table-header" onclick="toggleTableBody(this)">
          <div class="table-title">
            <span class="table-name">{{$schema.Name}}.{{.Name}}</span>
            <span class="badge {{if eq .Type "view"}}badge-soc2{{else}}badge-success{{end}}">{{.Type}}</span>
            {{if gt .PIICount 0}}
            <span class="badge badge-pii">⚠️ {{.PIICount}} PII</span>
            {{end}}
          </div>
          <div class="table-stats">
            <span>{{.RowCount}} rows</span>
            <span>•</span>
            <span>{{.SizeFormatted}}</span>
            <span>•</span>
            <span>{{len .Columns}} cols</span>
            <span class="toggle-indicator">▼</span>
          </div>
        </div>

        <div class="table-body">
          {{if .Comment}}
          <div class="table-comment-banner">
            {{.Comment}}
          </div>
          {{end}}

          <div class="data-table-container">
            <table class="columns-table">
              <thead>
                <tr>
                  <th style="width: 25%;">Column</th>
                  <th style="width: 15%;">Type</th>
                  <th style="width: 10%;">Nullable</th>
                  <th style="width: 15%;">Default</th>
                  <th style="width: 15%;">PII Tag</th>
                  <th style="width: 20%;">Description</th>
                </tr>
              </thead>
              <tbody>
                {{range .Columns}}
                <tr class="col-row" data-col="{{.Name}}" data-pii="{{.PIIType}}">
                  <td>
                    <div class="col-name">
                      {{if .IsPrimary}}<span class="badge badge-pk" title="Primary Key">PK</span>{{end}}
                      {{if .IsForeignKey}}<span class="badge badge-fk" title="Foreign Key">FK</span>{{end}}
                      <span>{{.Name}}</span>
                    </div>
                  </td>
                  <td class="col-type">{{.Type}}</td>
                  <td>{{if .IsNullable}}<span style="color: var(--muted);">YES</span>{{else}}<strong>NO</strong>{{end}}</td>
                  <td style="font-family: monospace; font-size: 0.75rem;">{{if .Default}}{{.Default}}{{else}}-{{end}}</td>
                  <td>
                    {{if .PIIType}}
                    <span class="badge badge-pii">🛡️ {{.PIIType}}</span>
                    {{else}}
                    <span style="color: var(--muted);">-</span>
                    {{end}}
                  </td>
                  <td class="col-desc">
                    {{if .Comment}}
                    {{.Comment}}
                    {{else}}
                    <span class="col-empty-desc">No description</span>
                    {{end}}
                  </td>
                </tr>
                {{end}}
              </tbody>
            </table>
          </div>

          {{if .Indexes}}
          <div class="sub-section">
            <div class="sub-section-title">Indexes ({{len .Indexes}})</div>
            <div class="chip-list">
              {{range .Indexes}}
              <div class="chip">
                <strong>{{.Name}}</strong>: ({{range $i, $c := .Columns}}{{if $i}}, {{end}}{{$c}}{{end}})
                {{if .IsUnique}}<span class="badge badge-pk" style="margin-left: 4px;">UNIQUE</span>{{end}}
              </div>
              {{end}}
            </div>
          </div>
          {{end}}

          {{if .ForeignKeys}}
          <div class="sub-section">
            <div class="sub-section-title">Foreign Keys ({{len .ForeignKeys}})</div>
            <div class="chip-list">
              {{range .ForeignKeys}}
              <div class="chip">
                {{.Column}} → <strong>{{.RefTable}}</strong>({{.RefColumn}})
              </div>
              {{end}}
            </div>
          </div>
          {{end}}
        </div>
      </div>
      {{end}}
      {{end}}
    </div>
  </div>

  <script>
    // Theme toggle
    const themeBtn = document.getElementById('themeBtn');
    let currentTheme = localStorage.getItem('dblens_dict_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', currentTheme);

    themeBtn.addEventListener('click', () => {
      currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', currentTheme);
      localStorage.setItem('dblens_dict_theme', currentTheme);
    });

    // Expand/Collapse table card
    function toggleTableBody(header) {
      const body = header.nextElementSibling;
      const indicator = header.querySelector('.toggle-indicator');
      if (body.style.display === 'none') {
        body.style.display = 'block';
        indicator.textContent = '▼';
      } else {
        body.style.display = 'none';
        indicator.textContent = '▶';
      }
    }

    // Toggle all tables
    let allExpanded = true;
    document.getElementById('toggleAllBtn').addEventListener('click', () => {
      allExpanded = !allExpanded;
      document.querySelectorAll('.table-body').forEach(b => {
        b.style.display = allExpanded ? 'block' : 'none';
      });
      document.querySelectorAll('.toggle-indicator').forEach(i => {
        i.textContent = allExpanded ? '▼' : '▶';
      });
    });

    // Search and filter logic
    const searchInput = document.getElementById('searchInput');
    const schemaSelect = document.getElementById('schemaSelect');
    const piiToggle = document.getElementById('piiToggle');
    const tableCards = document.querySelectorAll('.table-card');

    function applyFilters() {
      const query = searchInput.value.toLowerCase().trim();
      const selectedSchema = schemaSelect.value;
      const piiOnly = piiToggle.checked;

      tableCards.forEach(card => {
        const schema = card.getAttribute('data-schema');
        const tableName = card.getAttribute('data-table').toLowerCase();
        const hasPii = card.getAttribute('data-has-pii') === 'true';

        // Schema filter
        if (selectedSchema && schema !== selectedSchema) {
          card.style.display = 'none';
          return;
        }

        // PII only filter
        if (piiOnly && !hasPii) {
          card.style.display = 'none';
          return;
        }

        // Search query filter
        if (query) {
          let cardMatches = tableName.includes(query) || schema.toLowerCase().includes(query);
          const colRows = card.querySelectorAll('.col-row');
          let colMatches = false;

          colRows.forEach(row => {
            const colName = row.getAttribute('data-col').toLowerCase();
            const piiTag = row.getAttribute('data-pii').toLowerCase();
            const textContent = row.textContent.toLowerCase();
            if (colName.includes(query) || piiTag.includes(query) || textContent.includes(query)) {
              colMatches = true;
              row.style.background = 'var(--badge-bg)';
            } else {
              row.style.background = '';
            }
          });

          if (!cardMatches && !colMatches) {
            card.style.display = 'none';
            return;
          }
        } else {
          card.querySelectorAll('.col-row').forEach(row => row.style.background = '');
        }

        card.style.display = 'block';
      });
    }

    searchInput.addEventListener('input', applyFilters);
    schemaSelect.addEventListener('change', applyFilters);
    piiToggle.addEventListener('change', applyFilters);
  </script>
</body>
</html>`
