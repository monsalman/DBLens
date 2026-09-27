import { useState, useEffect, useCallback } from 'react'
import { api } from '../../lib/api'
import { useAppStore } from '../../stores/appStore'
import type {
  PartitionTopology,
  PartitionNode,
  DetachPartitionRequest,
} from './partitionHelper'

export function usePartitionTopology(schema?: string, table?: string) {
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
  const connections = useAppStore((s) => s.connections)

  const [topology, setTopology] = useState<PartitionTopology | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<PartitionNode | null>(null)
  const [metric, setMetric] = useState<'bytes' | 'rows'>('bytes')
  const [viewMode, setViewMode] = useState<'treemap' | 'tree'>('treemap')
  const [isGeneratorOpen, setIsGeneratorOpen] = useState<boolean>(false)
  const [isDetaching, setIsDetaching] = useState<boolean>(false)

  const fetchTopology = useCallback(async () => {
    if (!activeConnectionId || !table) {
      setTopology(null)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const data = await api.getPartitions(activeConnectionId, schema, table, connections)
      setTopology(data)
      if (data.partitions && data.partitions.length > 0) {
        setSelectedNode(data.partitions[0])
      } else {
        setSelectedNode(null)
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to inspect partitions')
      setTopology(null)
    } finally {
      setIsLoading(false)
    }
  }, [activeConnectionId, schema, table, connections])

  useEffect(() => {
    let ignore = false
    if (!activeConnectionId || !table) {
      return
    }

    api.getPartitions(activeConnectionId, schema, table, connections)
      .then((data) => {
        if (!ignore) {
          setTopology(data)
          if (data.partitions && data.partitions.length > 0) {
            setSelectedNode(data.partitions[0])
          } else {
            setSelectedNode(null)
          }
        }
      })
      .catch((err: any) => {
        if (!ignore) {
          setError(err?.message || 'Failed to inspect partitions')
          setTopology(null)
        }
      })

    return () => {
      ignore = true
    }
  }, [activeConnectionId, schema, table, connections])

  const detachPartition = async (partitionName: string, concurrently = true): Promise<boolean> => {
    if (!activeConnectionId || !table || !partitionName) return false

    setIsDetaching(true)
    try {
      const req: DetachPartitionRequest = {
        parentTable: table,
        schema: schema || topology?.schema,
        partitionName,
        concurrently,
      }
      await api.detachPartition(activeConnectionId, req, connections)
      await fetchTopology()
      return true
    } catch (err: any) {
      alert(`Detach failed: ${err.message || err}`)
      return false
    } finally {
      setIsDetaching(false)
    }
  }

  const exportMarkdown = async () => {
    if (!activeConnectionId || !table) return
    try {
      const md = await api.exportPartitionMD(activeConnectionId, schema, table, connections)
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `partition-topology-${table}.md`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err: any) {
      alert(`Export failed: ${err.message || err}`)
    }
  }

  return {
    topology,
    isLoading,
    error,
    selectedNode,
    metric,
    viewMode,
    isGeneratorOpen,
    isDetaching,
    setSelectedNode,
    setMetric,
    setViewMode,
    setIsGeneratorOpen,
    refetch: fetchTopology,
    detachPartition,
    exportMarkdown,
  }
}
