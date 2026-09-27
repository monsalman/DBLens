import { useState, useCallback } from 'react'
import type {
  QueryCanvasState,
  CanvasFilter,
  CanvasHaving,
  CanvasOrderBy,
  TableMeta,
  ERDTable,
} from '../../lib/api'
import {
  createInitialCanvasState,
  addTableToCanvas,
  removeTableFromCanvas,
  toggleColumnSelection,
  selectAllColumns,
  setColumnAggregate,
  setColumnAlias,
  setTableAlias,
  updateTablePosition,
  addJoin,
  updateJoinType,
  removeJoin,
  addFilter as helperAddFilter,
  updateFilter as helperUpdateFilter,
  removeFilter as helperRemoveFilter,
  addHaving as helperAddHaving,
  updateHaving as helperUpdateHaving,
  removeHaving as helperRemoveHaving,
  addOrderBy as helperAddOrderBy,
  updateOrderBy as helperUpdateOrderBy,
  removeOrderBy as helperRemoveOrderBy,
} from './queryBuilderHelper'

export function useQueryBuilder(initial?: QueryCanvasState) {
  const [state, setState] = useState<QueryCanvasState>(initial || createInitialCanvasState())

  const addTable = useCallback((table: TableMeta | ERDTable, position?: { x: number; y: number }) => {
    setState((prev) => addTableToCanvas(prev, table, position))
  }, [])

  const removeTable = useCallback((tableId: string) => {
    setState((prev) => removeTableFromCanvas(prev, tableId))
  }, [])

  const toggleColumn = useCallback((tableId: string, columnName: string, forced?: boolean) => {
    setState((prev) => toggleColumnSelection(prev, tableId, columnName, forced))
  }, [])

  const selectAll = useCallback((tableId: string, selected: boolean) => {
    setState((prev) => selectAllColumns(prev, tableId, selected))
  }, [])

  const setAggregate = useCallback((tableId: string, columnName: string, aggregate: string) => {
    setState((prev) => setColumnAggregate(prev, tableId, columnName, aggregate))
  }, [])

  const setColAlias = useCallback((tableId: string, columnName: string, alias: string) => {
    setState((prev) => setColumnAlias(prev, tableId, columnName, alias))
  }, [])

  const setTblAlias = useCallback((tableId: string, alias: string) => {
    setState((prev) => setTableAlias(prev, tableId, alias))
  }, [])

  const updatePosition = useCallback((tableId: string, pos: { x: number; y: number }) => {
    setState((prev) => updateTablePosition(prev, tableId, pos))
  }, [])

  const connectJoin = useCallback(
    (
      sourceTableId: string,
      sourceColumn: string,
      targetTableId: string,
      targetColumn: string,
      joinType: string = 'INNER'
    ) => {
      setState((prev) => addJoin(prev, sourceTableId, sourceColumn, targetTableId, targetColumn, joinType))
    },
    []
  )

  const changeJoinType = useCallback((joinId: string, newType: string) => {
    setState((prev) => updateJoinType(prev, joinId, newType))
  }, [])

  const deleteJoin = useCallback((joinId: string) => {
    setState((prev) => removeJoin(prev, joinId))
  }, [])

  const addFilter = useCallback((filter: Omit<CanvasFilter, 'id'>) => {
    setState((prev) => helperAddFilter(prev, filter))
  }, [])

  const updateFilter = useCallback((filterId: string, partial: Partial<CanvasFilter>) => {
    setState((prev) => helperUpdateFilter(prev, filterId, partial))
  }, [])

  const removeFilter = useCallback((filterId: string) => {
    setState((prev) => helperRemoveFilter(prev, filterId))
  }, [])

  const addHaving = useCallback((having: Omit<CanvasHaving, 'id'>) => {
    setState((prev) => helperAddHaving(prev, having))
  }, [])

  const updateHaving = useCallback((havingId: string, partial: Partial<CanvasHaving>) => {
    setState((prev) => helperUpdateHaving(prev, havingId, partial))
  }, [])

  const removeHaving = useCallback((havingId: string) => {
    setState((prev) => helperRemoveHaving(prev, havingId))
  }, [])

  const addOrderBy = useCallback((order: Omit<CanvasOrderBy, 'id'>) => {
    setState((prev) => helperAddOrderBy(prev, order))
  }, [])

  const updateOrderBy = useCallback((orderId: string, partial: Partial<CanvasOrderBy>) => {
    setState((prev) => helperUpdateOrderBy(prev, orderId, partial))
  }, [])

  const removeOrderBy = useCallback((orderId: string) => {
    setState((prev) => helperRemoveOrderBy(prev, orderId))
  }, [])

  const setDistinct = useCallback((distinct: boolean) => {
    setState((prev) => ({ ...prev, distinct }))
  }, [])

  const setLimit = useCallback((limit?: number) => {
    setState((prev) => ({ ...prev, limit }))
  }, [])

  const setOffset = useCallback((offset?: number) => {
    setState((prev) => ({ ...prev, offset }))
  }, [])

  const loadState = useCallback((newState: QueryCanvasState) => {
    setState(newState)
  }, [])

  const reset = useCallback(() => {
    setState(createInitialCanvasState())
  }, [])

  return {
    state,
    setState,
    addTable,
    removeTable,
    toggleColumn,
    selectAll,
    setAggregate,
    setColAlias,
    setTblAlias,
    updatePosition,
    connectJoin,
    changeJoinType,
    deleteJoin,
    addFilter,
    updateFilter,
    removeFilter,
    addHaving,
    updateHaving,
    removeHaving,
    addOrderBy,
    updateOrderBy,
    removeOrderBy,
    setDistinct,
    setLimit,
    setOffset,
    loadState,
    reset,
  }
}
