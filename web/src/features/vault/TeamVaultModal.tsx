import React, { useState } from 'react'
import {
  X,
  Shield,
  Download,
  Upload,
  Lock,
  Unlock,
  KeyRound,
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  Layers,
  Sparkles,
} from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { api, type VaultConnection, type ImportVaultResponse } from '../../lib/api'
import { useVault } from './useVault'
import { VaultConnectionPicker } from './VaultConnectionPicker'
import { PolicyGuardrailBadge } from './PolicyGuardrailBadge'
import {
  parseVaultContainer,
  validatePassphrase,
  downloadEncryptedVaultFile,
  convertVaultItemToConnection,
  formatVaultEnvironment,
  scrubDSN,
} from './vaultHelper'

interface Props {
  isOpen: boolean
  onClose: () => void
}

export const TeamVaultModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'export' | 'import' | 'status'>('export')

  const connections = useAppStore((s) => s.connections)
  const setConnections = useAppStore((s) => s.setConnections)

  const {
    status,
    isUnlocked,
    loading,
    fetchStatus,
    exportVault,
    importVault,
    unlockVault,
    lockVault,
  } = useVault()

  // ── Export Tab State ──
  const [vaultName, setVaultName] = useState('Team Core Vault')
  const [vaultDesc, setVaultDesc] = useState('Shared engineering connection profiles')
  const [selectedConns, setSelectedConns] = useState<Map<string, VaultConnection>>(() => {
    const map = new Map<string, VaultConnection>()
    for (const c of connections) {
      map.set(c.id, {
        id: c.id,
        name: c.label || c.name || c.id,
        driver: (c.driver || c.dialect || 'postgres') as any,
        dsn: c.dsn,
        environment: c.environment || 'development',
        read_only: !!c.readOnly,
        policy: {
          enforce_read_only: !!c.readOnly || c.environment === 'production',
          require_audit_log: c.environment === 'production',
        },
      })
    }
    return map
  })
  const [globalProdReadOnly, setGlobalProdReadOnly] = useState(true)
  const [requireAuditProd, setRequireAuditProd] = useState(true)
  const [scrubPasswords, setScrubPasswords] = useState(true)
  const [exportPassphrase, setExportPassphrase] = useState('')
  const [exportPassphraseConfirm, setExportPassphraseConfirm] = useState('')
  const [showExportPass, setShowExportPass] = useState(false)
  const [exportSuccess, setExportSuccess] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  // ── Import Tab State ──
  const [rawContainerText, setRawContainerText] = useState('')
  const [importPassphrase, setImportPassphrase] = useState('')
  const [showImportPass, setShowImportPass] = useState(false)
  const [interpolateEnv, setInterpolateEnv] = useState(true)
  const [importPreview, setImportPreview] = useState<ImportVaultResponse | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [importSuccess, setImportSuccess] = useState<string | null>(null)

  // ── Unlock State in Status Tab ──
  const [unlockPassphrase, setUnlockPassphrase] = useState('')
  const [showUnlockPass, setShowUnlockPass] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  if (!isOpen) return null

  // ── Handler: Export ──
  const handleExport = async (e: React.FormEvent) => {
    e.preventDefault()
    setExportError(null)
    setExportSuccess(null)

    if (selectedConns.size === 0) {
      setExportError('Please select at least one connection to include in the vault.')
      return
    }

    const passCheck = validatePassphrase(exportPassphrase)
    if (!passCheck.valid) {
      setExportError(passCheck.error || 'Invalid passphrase')
      return
    }

    if (exportPassphrase !== exportPassphraseConfirm) {
      setExportError('Passphrases do not match. Please verify.')
      return
    }

    try {
      const connList = Array.from(selectedConns.values())
      const res = await exportVault({
        name: vaultName,
        description: vaultDesc,
        passphrase: exportPassphrase,
        connections: connList,
        policies: {
          global_read_only_prod: globalProdReadOnly,
          require_audit_all_prod: requireAuditProd,
        },
        scrub_passwords: scrubPasswords,
      })

      downloadEncryptedVaultFile(res.container, res.filename)
      setExportSuccess(`Encrypted vault generated and downloaded (${res.filename}).`)
      setExportPassphrase('')
      setExportPassphraseConfirm('')
    } catch (err: any) {
      setExportError(err?.message || 'Failed to generate vault file')
    }
  }

  // ── Handler: Import / Decrypt Preview ──
  const handlePreviewImport = async (e: React.FormEvent) => {
    e.preventDefault()
    setImportError(null)
    setImportSuccess(null)
    setImportPreview(null)

    const parseRes = parseVaultContainer(rawContainerText)
    if (!parseRes.valid || !parseRes.container) {
      setImportError(parseRes.error || 'Invalid vault container format')
      return
    }

    if (!importPassphrase.trim()) {
      setImportError('Please enter vault passphrase to decrypt')
      return
    }

    try {
      const res = await importVault({
        container: parseRes.container,
        passphrase: importPassphrase,
        apply_policies: true,
        interpolate_env: interpolateEnv,
      })
      setImportPreview(res)
    } catch (err: any) {
      setImportError(err?.message || 'Decryption failed: check passphrase or container integrity')
    }
  }

  // ── Handler: Apply Imported Connections ──
  const handleApplyConnections = () => {
    if (!importPreview || !importPreview.connections) return

    const existing = api.getProfiles()
    const existingIds = new Set(existing.map((c) => c.id))
    const existingNames = new Set(existing.map((c) => c.label || c.name))

    const newProfiles = importPreview.connections.map((vc) => {
      const base = convertVaultItemToConnection(vc)
      let id = base.id
      if (existingIds.has(id)) {
        id = `vault_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      }
      let label = base.label
      if (existingNames.has(label)) {
        label = `${label} (Vault)`
      }
      // Scrub plaintext credentials before persisting to localStorage
      const placeholder = vc.environment
        ? `$${vc.environment.toUpperCase()}_DB_PASSWORD`
        : '$DATABASE_PASSWORD'
      const scrubbedDsn = scrubDSN(base.dsn, placeholder).dsn
      return { ...base, id, label, dsn: scrubbedDsn }
    })

    const updated = [...existing, ...newProfiles]
    api.saveProfiles(updated)
    setConnections(updated)
    setImportSuccess(`Successfully imported ${newProfiles.length} connection(s) to your workspace!`)
    setImportPreview(null)
    setRawContainerText('')
    setImportPassphrase('')
  }

  // ── Handler: File Upload ──
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      const text = evt.target?.result as string
      if (text) {
        setRawContainerText(text)
        setImportError(null)
      }
    }
    reader.readAsText(file)
  }

  // ── Handler: Unlock in Status Tab ──
  const handleStatusUnlock = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatusMessage(null)
    try {
      await unlockVault({ passphrase: unlockPassphrase })
      setUnlockPassphrase('')
      setStatusMessage('Vault successfully unlocked in session memory.')
    } catch (err: any) {
      setStatusMessage(`Unlock failed: ${err.message}`)
    }
  }

  // ── Handler: Lock ──
  const handleStatusLock = async () => {
    try {
      await lockVault()
      setStatusMessage('Vault locked. Credentials cleared from memory.')
    } catch (err: any) {
      setStatusMessage(`Lock failed: ${err.message}`)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between shrink-0 bg-[var(--bg)]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-500">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-[var(--fg)]">
                  Team Connection Vault & Environment Sync
                </h2>
                <span
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border ${
                    isUnlocked
                      ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
                      : 'bg-zinc-500/10 text-[var(--muted)] border-[var(--border)]'
                  }`}
                >
                  {isUnlocked ? <Unlock className="w-2.5 h-2.5" /> : <Lock className="w-2.5 h-2.5" />}
                  <span>{isUnlocked ? 'UNLOCKED' : 'LOCKED'}</span>
                </span>
              </div>
              <p className="text-xs text-[var(--muted)]">
                Zero-knowledge Argon2id + AES-256-GCM encryption with team guardrail policies.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center border-b border-[var(--border)] px-5 bg-[var(--surface)] text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('export')}
            className={`flex items-center gap-1.5 py-2.5 px-3 border-b-2 font-medium transition-colors ${
              activeTab === 'export'
                ? 'border-indigo-500 text-indigo-500'
                : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
            }`}
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Vault</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('import')}
            className={`flex items-center gap-1.5 py-2.5 px-3 border-b-2 font-medium transition-colors ${
              activeTab === 'import'
                ? 'border-indigo-500 text-indigo-500'
                : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Import & Sync</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('status')
              fetchStatus()
            }}
            className={`flex items-center gap-1.5 py-2.5 px-3 border-b-2 font-medium transition-colors ${
              activeTab === 'status'
                ? 'border-indigo-500 text-indigo-500'
                : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Status & Policies</span>
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* TAB 1: EXPORT */}
          {activeTab === 'export' && (
            <form onSubmit={handleExport} className="space-y-4 text-xs">
              {exportError && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-500 rounded-lg flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{exportError}</span>
                </div>
              )}
              {exportSuccess && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-500 rounded-lg flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{exportSuccess}</span>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--fg)] mb-1">
                    Vault Name
                  </label>
                  <input
                    type="text"
                    value={vaultName}
                    onChange={(e) => setVaultName(e.target.value)}
                    className="w-full bg-[var(--bg)] text-[var(--fg)] text-xs px-3 py-1.5 rounded-lg border border-[var(--border)] focus:outline-none focus:border-indigo-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--fg)] mb-1">
                    Description
                  </label>
                  <input
                    type="text"
                    value={vaultDesc}
                    onChange={(e) => setVaultDesc(e.target.value)}
                    className="w-full bg-[var(--bg)] text-[var(--fg)] text-xs px-3 py-1.5 rounded-lg border border-[var(--border)] focus:outline-none focus:border-indigo-500 transition-colors"
                  />
                </div>
              </div>

              {/* Connections Picker */}
              <div>
                <label className="block text-xs font-medium text-[var(--fg)] mb-1.5">
                  Select Connections to Include
                </label>
                <VaultConnectionPicker
                  connections={connections}
                  selectedItems={selectedConns}
                  onChange={setSelectedConns}
                  scrubPasswords={scrubPasswords}
                />
              </div>

              {/* Team Guardrail Policies */}
              <div className="p-3.5 border border-[var(--border)] rounded-lg bg-[var(--bg)] space-y-2.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--fg)]">
                  <Shield className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Team Guardrail Policies</span>
                </div>

                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={globalProdReadOnly}
                    onChange={(e) => setGlobalProdReadOnly(e.target.checked)}
                    className="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <div className="text-xs">
                    <span className="font-medium text-[var(--fg)]">
                      Enforce Read-Only Safe Mode on Production Connections
                    </span>
                    <p className="text-[11px] text-[var(--muted)]">
                      Permanently activates Safe Mode for production databases when imported by non-admin roles.
                    </p>
                  </div>
                </label>

                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={requireAuditProd}
                    onChange={(e) => setRequireAuditProd(e.target.checked)}
                    className="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <div className="text-xs">
                    <span className="font-medium text-[var(--fg)]">
                      Mandatory Audit Logging for Production Queries
                    </span>
                    <p className="text-[11px] text-[var(--muted)]">
                      Forces immutable cryptographic hash-chained audit trails on production traffic.
                    </p>
                  </div>
                </label>

                <label className="flex items-start gap-2 cursor-pointer pt-1 border-t border-[var(--border)]">
                  <input
                    type="checkbox"
                    checked={scrubPasswords}
                    onChange={(e) => setScrubPasswords(e.target.checked)}
                    className="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <div className="text-xs">
                    <span className="font-medium text-[var(--fg)]">
                      Scrub Passwords into Dynamic Environment Placeholders
                    </span>
                    <p className="text-[11px] text-[var(--muted)]">
                      Replaces plaintext credentials in connection strings with $DATABASE_PASSWORD or ${'{ENV}'}_DB_PASSWORD.
                    </p>
                  </div>
                </label>
              </div>

              {/* Passphrase */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                <div>
                  <label className="block text-xs font-medium text-[var(--fg)] mb-1">
                    Master Passphrase (min 8 chars)
                  </label>
                  <div className="relative">
                    <KeyRound className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                    <input
                      type={showExportPass ? 'text' : 'password'}
                      value={exportPassphrase}
                      onChange={(e) => setExportPassphrase(e.target.value)}
                      placeholder="Strong team passphrase..."
                      className="w-full bg-[var(--bg)] text-[var(--fg)] text-xs pl-8 pr-8 py-2 rounded-lg border border-[var(--border)] focus:outline-none focus:border-indigo-500 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowExportPass(!showExportPass)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--fg)]"
                    >
                      {showExportPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--fg)] mb-1">
                    Confirm Passphrase
                  </label>
                  <div className="relative">
                    <KeyRound className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                    <input
                      type={showExportPass ? 'text' : 'password'}
                      value={exportPassphraseConfirm}
                      onChange={(e) => setExportPassphraseConfirm(e.target.value)}
                      placeholder="Repeat passphrase..."
                      className="w-full bg-[var(--bg)] text-[var(--fg)] text-xs pl-8 pr-3 py-2 rounded-lg border border-[var(--border)] focus:outline-none focus:border-indigo-500 font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border)]">
                <button
                  type="submit"
                  disabled={loading || selectedConns.size === 0 || !exportPassphrase}
                  className="px-4 py-2 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {loading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  <span>Export & Download .dblens-vault.enc</span>
                </button>
              </div>
            </form>
          )}

          {/* TAB 2: IMPORT & SYNC */}
          {activeTab === 'import' && (
            <div className="space-y-4 text-xs">
              {importError && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-500 rounded-lg flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{importError}</span>
                </div>
              )}
              {importSuccess && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-500 rounded-lg flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{importSuccess}</span>
                </div>
              )}

              {/* Upload Dropzone */}
              <div className="border-2 border-dashed border-[var(--border)] hover:border-indigo-500/60 rounded-xl p-4 text-center transition-colors">
                <Upload className="w-6 h-6 text-indigo-500 mx-auto mb-2" />
                <p className="text-xs font-medium text-[var(--fg)]">
                  Choose a <span className="font-mono text-indigo-400">.dblens-vault.enc</span> file
                </p>
                <p className="text-[11px] text-[var(--muted)] mb-3">
                  Upload an encrypted team container or paste JSON below
                </p>
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--surface)] hover:bg-[var(--hover)] border border-[var(--border)] text-xs text-[var(--fg)] cursor-pointer transition-colors">
                  <span>Browse File</span>
                  <input
                    type="file"
                    accept=".enc,.json"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>

              {/* Container JSON textarea */}
              <div>
                <label className="block text-xs font-medium text-[var(--fg)] mb-1">
                  Vault Container Payload
                </label>
                <textarea
                  rows={4}
                  value={rawContainerText}
                  onChange={(e) => setRawContainerText(e.target.value)}
                  placeholder='Paste {"version": 1, "kdf": "argon2id", ...} content here'
                  className="w-full bg-[var(--bg)] text-[var(--fg)] text-xs p-2.5 rounded-lg border border-[var(--border)] focus:outline-none focus:border-indigo-500 font-mono resize-none"
                />
              </div>

              {/* Passphrase & Options */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--fg)] mb-1">
                    Decryption Passphrase
                  </label>
                  <div className="relative">
                    <KeyRound className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                    <input
                      type={showImportPass ? 'text' : 'password'}
                      value={importPassphrase}
                      onChange={(e) => setImportPassphrase(e.target.value)}
                      placeholder="Enter team vault passphrase..."
                      className="w-full bg-[var(--bg)] text-[var(--fg)] text-xs pl-8 pr-8 py-2 rounded-lg border border-[var(--border)] focus:outline-none focus:border-indigo-500 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowImportPass(!showImportPass)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--fg)]"
                    >
                      {showImportPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <div className="flex flex-col justify-end space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={interpolateEnv}
                      onChange={(e) => setInterpolateEnv(e.target.checked)}
                      className="rounded text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-xs text-[var(--fg)]">
                      Interpolate dynamic environment variables ($DB_PASS)
                    </span>
                  </label>

                  <div className="flex items-center gap-2 text-xs text-[var(--muted)] py-1">
                    <Shield className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                    <span>
                      Team guardrail policies (Safe Mode & Audit) are strictly enforced
                    </span>
                  </div>
                </div>
              </div>

              {/* Decrypt & Preview Button */}
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={handlePreviewImport}
                  disabled={loading || !rawContainerText.trim() || !importPassphrase.trim()}
                  className="px-4 py-2 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {loading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Unlock className="w-3.5 h-3.5" />
                  )}
                  <span>Decrypt & Preview Connections</span>
                </button>
              </div>

              {/* Decrypted Preview Section */}
              {importPreview && (
                <div className="p-4 border border-indigo-500/30 rounded-xl bg-indigo-500/5 space-y-3 mt-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-semibold text-[var(--fg)] flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                        <span>Decrypted Vault Preview</span>
                      </h4>
                      <p className="text-[11px] text-[var(--muted)]">
                        {importPreview.connections.length} connection(s) available for sync
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleApplyConnections}
                      className="px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Apply to My Connections</span>
                    </button>
                  </div>

                  {/* Substituted Env Vars Info */}
                  {importPreview.substituted_vars && importPreview.substituted_vars.length > 0 && (
                    <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-600 dark:text-emerald-400">
                      ✓ Interpolated environment variables:{' '}
                      <span className="font-mono">
                        {importPreview.substituted_vars.join(', ')}
                      </span>
                    </div>
                  )}

                  {/* Enforced Policies Logs */}
                  {importPreview.enforced_policies && importPreview.enforced_policies.length > 0 && (
                    <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-600 dark:text-amber-400 space-y-0.5">
                      <div className="font-semibold">Guardrail Policies Enforced:</div>
                      {importPreview.enforced_policies.map((log, idx) => (
                        <div key={idx}>• {log}</div>
                      ))}
                    </div>
                  )}

                  {/* Connections List */}
                  <div className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg bg-[var(--surface)] overflow-hidden">
                    {importPreview.connections.map((c) => {
                      const envBadge = formatVaultEnvironment(c.environment)
                      return (
                        <div
                          key={c.id}
                          className="p-2.5 flex items-center justify-between text-xs gap-3"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-[var(--fg)] truncate">
                                {c.name}
                              </span>
                              <span
                                className={`text-[9px] px-1 py-0.2 rounded border font-mono ${envBadge.colorClass}`}
                              >
                                {envBadge.label}
                              </span>
                              <span className="text-[10px] text-[var(--muted)] font-mono uppercase">
                                {c.driver}
                              </span>
                            </div>
                            <div className="text-[10px] font-mono text-[var(--muted)] truncate mt-0.5">
                              {c.dsn}
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {c.read_only && (
                              <PolicyGuardrailBadge type="safe_mode" label="Safe Mode" />
                            )}
                            {c.policy?.require_audit_log && (
                              <PolicyGuardrailBadge type="audit" label="Audit Trail" />
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: STATUS & POLICIES */}
          {activeTab === 'status' && (
            <div className="space-y-4 text-xs">
              {statusMessage && (
                <div className="p-3 bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 rounded-lg flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{statusMessage}</span>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="p-3.5 rounded-lg border border-[var(--border)] bg-[var(--bg)]">
                  <span className="text-[11px] text-[var(--muted)]">Vault State</span>
                  <div className="mt-1 flex items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 text-xs font-semibold ${
                        isUnlocked ? 'text-emerald-500' : 'text-[var(--muted)]'
                      }`}
                    >
                      {isUnlocked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                      <span>{isUnlocked ? 'Unlocked in Memory' : 'Locked'}</span>
                    </span>
                  </div>
                </div>

                <div className="p-3.5 rounded-lg border border-[var(--border)] bg-[var(--bg)]">
                  <span className="text-[11px] text-[var(--muted)]">Active Connections</span>
                  <div className="mt-1 text-sm font-semibold text-[var(--fg)]">
                    {status?.connections_count ?? 0} Loaded
                  </div>
                </div>

                <div className="p-3.5 rounded-lg border border-[var(--border)] bg-[var(--bg)]">
                  <span className="text-[11px] text-[var(--muted)]">Unlocked At</span>
                  <div className="mt-1 text-xs font-mono text-[var(--fg)] truncate">
                    {status?.unlocked_at || '—'}
                  </div>
                </div>
              </div>

              {/* Active Guardrails */}
              <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--bg)] space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-[var(--fg)] flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-indigo-500" />
                    <span>Active Team Guardrails</span>
                  </h4>
                  <button
                    type="button"
                    onClick={fetchStatus}
                    className="p-1 text-[var(--muted)] hover:text-[var(--fg)]"
                    title="Refresh status"
                  >
                    <RefreshCw className="w-3 h-3" />
                  </button>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between p-2 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
                    <div>
                      <div className="font-medium text-[var(--fg)]">Production Read-Only Safe Mode</div>
                      <div className="text-[11px] text-[var(--muted)]">
                        Blocks unconstrained updates/deletes and DDL on production targets
                      </div>
                    </div>
                    <PolicyGuardrailBadge
                      type={status?.active_policies?.global_read_only_prod ? 'safe_mode' : 'custom'}
                      label={status?.active_policies?.global_read_only_prod ? 'ENFORCED' : 'OFF'}
                    />
                  </div>

                  <div className="flex items-center justify-between p-2 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
                    <div>
                      <div className="font-medium text-[var(--fg)]">Production Mandatory Audit Trail</div>
                      <div className="text-[11px] text-[var(--muted)]">
                        Cryptographic SHA-256 chain compliance logging for all queries
                      </div>
                    </div>
                    <PolicyGuardrailBadge
                      type={status?.active_policies?.require_audit_all_prod ? 'audit' : 'custom'}
                      label={status?.active_policies?.require_audit_all_prod ? 'MANDATORY' : 'OFF'}
                    />
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="pt-2 border-t border-[var(--border)] flex items-center justify-between">
                {isUnlocked ? (
                  <button
                    type="button"
                    onClick={handleStatusLock}
                    disabled={loading}
                    className="px-4 py-2 text-xs font-medium bg-red-600 hover:bg-red-500 text-white rounded-lg flex items-center gap-2 transition-colors cursor-pointer"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span>Lock Vault & Clear Memory</span>
                  </button>
                ) : (
                  <form onSubmit={handleStatusUnlock} className="flex items-center gap-2 w-full">
                    <div className="relative flex-1">
                      <KeyRound className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                      <input
                        type={showUnlockPass ? 'text' : 'password'}
                        value={unlockPassphrase}
                        onChange={(e) => setUnlockPassphrase(e.target.value)}
                        placeholder="Enter master passphrase to unlock..."
                        className="w-full bg-[var(--bg)] text-[var(--fg)] text-xs pl-8 pr-8 py-2 rounded-lg border border-[var(--border)] focus:outline-none focus:border-indigo-500 font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowUnlockPass(!showUnlockPass)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--fg)]"
                      >
                        {showUnlockPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <button
                      type="submit"
                      disabled={loading || !unlockPassphrase.trim()}
                      className="px-4 py-2 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer shrink-0"
                    >
                      <Unlock className="w-3.5 h-3.5" />
                      <span>Unlock</span>
                    </button>
                  </form>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
