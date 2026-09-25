import { useState, useCallback, useEffect } from 'react'
import {
  api,
  type VaultStatusResponse,
  type ExportVaultRequest,
  type ExportVaultResponse,
  type ImportVaultRequest,
  type ImportVaultResponse,
  type UnlockVaultRequest,
  type UnlockVaultResponse,
} from '../../lib/api'
import { useAppStore } from '../../stores/appStore'

export function useVault() {
  const [status, setStatus] = useState<VaultStatusResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isVaultUnlocked = useAppStore((s) => s.isVaultUnlocked)
  const setVaultUnlocked = useAppStore((s) => s.setVaultUnlocked)

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true)
      const res = await api.getVaultStatus()
      setStatus(res)
      setVaultUnlocked(res.is_unlocked)
      setError(null)
      return res
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch vault status')
      return null
    } finally {
      setLoading(false)
    }
  }, [setVaultUnlocked])

  const exportVault = useCallback(async (req: ExportVaultRequest): Promise<ExportVaultResponse> => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.exportVault(req)
      return res
    } catch (err: any) {
      setError(err?.message || 'Failed to export vault')
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  const importVault = useCallback(async (req: ImportVaultRequest): Promise<ImportVaultResponse> => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.importVault(req)
      return res
    } catch (err: any) {
      setError(err?.message || 'Failed to import vault')
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  const unlockVault = useCallback(async (req: UnlockVaultRequest): Promise<UnlockVaultResponse> => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.unlockVault(req)
      setVaultUnlocked(true)
      await fetchStatus()
      return res
    } catch (err: any) {
      setError(err?.message || 'Failed to unlock vault')
      throw err
    } finally {
      setLoading(false)
    }
  }, [fetchStatus, setVaultUnlocked])

  const lockVault = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await api.lockVault()
      setVaultUnlocked(false)
      await fetchStatus()
    } catch (err: any) {
      setError(err?.message || 'Failed to lock vault')
      throw err
    } finally {
      setLoading(false)
    }
  }, [fetchStatus, setVaultUnlocked])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  return {
    status,
    isUnlocked: isVaultUnlocked,
    loading,
    error,
    fetchStatus,
    exportVault,
    importVault,
    unlockVault,
    lockVault,
  }
}
