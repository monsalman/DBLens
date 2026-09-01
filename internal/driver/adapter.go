package driver

import (
	"github.com/dblens/dblens/internal/driver/types"
)

type ColumnMeta = types.ColumnMeta
type ForeignKey = types.ForeignKey
type TableMeta = types.TableMeta
type TableDetail = types.TableDetail
type QueryOptions = types.QueryOptions
type Filter = types.Filter
type QueryResult = types.QueryResult
type MutationType = types.MutationType

const (
	MutationInsert = types.MutationInsert
	MutationUpdate = types.MutationUpdate
	MutationDelete = types.MutationDelete
)

type Mutation = types.Mutation
type MutationResult = types.MutationResult
type ERDTable = types.ERDTable
type Driver = types.Driver
