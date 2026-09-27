package partition

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/dblens/dblens/internal/driver/types"
)

// InspectTopology inspects the physical partitioning layout, bounds, and storage size
// of a specified parent table across PostgreSQL, MySQL, and SQLite.
func InspectTopology(ctx context.Context, drv types.Driver, schema, table string) (*PartitionTopology, error) {
	if drv == nil {
		return nil, fmt.Errorf("database driver is required")
	}

	table = strings.TrimSpace(table)
	if table == "" {
		return nil, fmt.Errorf("table name is required")
	}

	dialect := strings.ToLower(strings.TrimSpace(drv.Dialect()))
	schema = strings.TrimSpace(schema)
	if schema == "" {
		switch dialect {
		case "postgres", "postgresql":
			schema = "public"
		case "mysql", "mariadb":
			schema = ""
		default:
			schema = "main"
		}
	}

	topo := &PartitionTopology{
		ParentTable: table,
		Schema:      schema,
		Dialect:     dialect,
		Strategy:    "NONE",
		Partitions:  []PartitionNode{},
	}

	switch dialect {
	case "postgres", "postgresql":
		if err := inspectPostgresTopology(ctx, drv, topo); err != nil {
			return nil, err
		}
	case "mysql", "mariadb":
		if err := inspectMySQLTopology(ctx, drv, topo); err != nil {
			return nil, err
		}
	case "sqlite", "sqlite3":
		if err := inspectSQLiteTopology(ctx, drv, topo); err != nil {
			return nil, err
		}
	default:
		// Default fallback
		topo.Strategy = "NONE"
	}

	// Calculate totals and percentages
	var totalRows, totalBytes int64
	for _, p := range topo.Partitions {
		totalRows += p.Rows
		totalBytes += p.Bytes
	}
	topo.TotalRows = totalRows
	topo.TotalBytes = totalBytes

	n := len(topo.Partitions)
	if n > 0 {
		for i := range topo.Partitions {
			p := &topo.Partitions[i]
			if totalRows > 0 {
				p.RowSharePct = float64(int((float64(p.Rows)/float64(totalRows))*1000)) / 10.0
			}
			if totalBytes > 0 {
				p.ByteSharePct = float64(int((float64(p.Bytes)/float64(totalBytes))*1000)) / 10.0
			}
		}

		meanBytes := float64(totalBytes) / float64(n)
		topo.Partitions = AssignPartitionStatus(topo.Partitions, meanBytes)
		topo.SkewIndex = CalculateSkewIndex(topo.Partitions)
		topo.HealthReport = EvaluatePartitionHealth(topo.ParentTable, topo.Strategy, topo.Partitions, time.Now().UTC())
	} else {
		topo.HealthReport = &PartitionHealthReport{
			ParentTable: topo.ParentTable,
			Score:       100,
			Warnings:    []string{},
		}
	}

	return topo, nil
}

func inspectPostgresTopology(ctx context.Context, drv types.Driver, topo *PartitionTopology) error {
	// 1. Check pg_partitioned_table for strategy and partition key
	stratQuery := `
		SELECT
			pt.partstrat,
			COALESCE(pg_get_partkeydef(pt.partrelid), '') AS partkey
		FROM pg_partitioned_table pt
		JOIN pg_class p ON pt.partrelid = p.oid
		JOIN pg_namespace pn ON p.relnamespace = pn.oid
		WHERE pn.nspname = $1 AND p.relname = $2;
	`
	res, err := drv.ExecuteRaw(ctx, stratQuery, topo.Schema, topo.ParentTable)
	if err == nil && res != nil && len(res.Rows) > 0 && len(res.Rows[0]) >= 2 {
		stratChar := fmt.Sprintf("%v", res.Rows[0][0])
		topo.PartitionKey = fmt.Sprintf("%v", res.Rows[0][1])
		switch stratChar {
		case "r":
			topo.Strategy = "RANGE"
		case "l":
			topo.Strategy = "LIST"
		case "h":
			topo.Strategy = "HASH"
		default:
			topo.Strategy = "RANGE"
		}
	}

	// 2. Query child partitions from pg_inherits
	partQuery := `
		SELECT
			c.relname AS partition_name,
			n.nspname AS partition_schema,
			COALESCE(pg_get_expr(c.relpartbound, c.oid), '') AS bound_expr,
			COALESCE(GREATEST(c.reltuples::bigint, 0), 0) AS row_count,
			COALESCE(pg_total_relation_size(c.oid), 0) AS total_bytes
		FROM pg_inherits i
		JOIN pg_class c ON i.inhrelid = c.oid
		JOIN pg_namespace n ON c.relnamespace = n.oid
		JOIN pg_class p ON i.inhparent = p.oid
		JOIN pg_namespace pn ON p.relnamespace = pn.oid
		WHERE pn.nspname = $1 AND p.relname = $2
		ORDER BY c.relname;
	`
	partRes, err := drv.ExecuteRaw(ctx, partQuery, topo.Schema, topo.ParentTable)
	if err != nil {
		return err
	}

	if partRes != nil {
		for _, row := range partRes.Rows {
			if len(row) < 5 {
				continue
			}
			pName := fmt.Sprintf("%v", row[0])
			pSchema := fmt.Sprintf("%v", row[1])
			bound := fmt.Sprintf("%v", row[2])
			if bound == "<nil>" {
				bound = ""
			}
			rowsVal, _ := parseRowInt64(row[3])
			bytesVal, _ := parseRowInt64(row[4])

			partType := strings.ToLower(topo.Strategy)
			if partType == "" || partType == "none" {
				partType = "range"
			}

			topo.Partitions = append(topo.Partitions, PartitionNode{
				Name:            pName,
				Schema:          pSchema,
				ParentTable:     topo.ParentTable,
				BoundExpression: bound,
				PartitionType:   partType,
				Rows:            rowsVal,
				Bytes:           bytesVal,
			})
		}
	}

	if len(topo.Partitions) > 0 && topo.Strategy == "NONE" {
		topo.Strategy = "INHERITANCE"
	}

	return nil
}

func inspectMySQLTopology(ctx context.Context, drv types.Driver, topo *PartitionTopology) error {
	schema := topo.Schema
	if schema == "" {
		if res, err := drv.ExecuteRaw(ctx, "SELECT DATABASE()"); err == nil && res != nil && len(res.Rows) > 0 && len(res.Rows[0]) > 0 {
			dbName := fmt.Sprintf("%v", res.Rows[0][0])
			if dbName != "<nil>" && dbName != "" {
				schema = dbName
				topo.Schema = dbName
			}
		}
	}

	query := `
		SELECT
			PARTITION_NAME,
			COALESCE(PARTITION_METHOD, '') AS PARTITION_METHOD,
			COALESCE(PARTITION_EXPRESSION, '') AS PARTITION_EXPRESSION,
			COALESCE(PARTITION_DESCRIPTION, '') AS PARTITION_DESCRIPTION,
			COALESCE(TABLE_ROWS, 0) AS TABLE_ROWS,
			COALESCE(DATA_LENGTH + INDEX_LENGTH, 0) AS TOTAL_BYTES
		FROM information_schema.PARTITIONS
		WHERE (TABLE_SCHEMA = ? OR ? = '') AND TABLE_NAME = ?
		  AND PARTITION_NAME IS NOT NULL
		ORDER BY PARTITION_ORDINAL_POSITION;
	`
	res, err := drv.ExecuteRaw(ctx, query, schema, schema, topo.ParentTable)
	if err != nil {
		return err
	}

	if res != nil && len(res.Rows) > 0 {
		first := res.Rows[0]
		if len(first) >= 3 {
			m := strings.ToUpper(fmt.Sprintf("%v", first[1]))
			if m != "" && m != "<NIL>" {
				topo.Strategy = m
			}
			k := fmt.Sprintf("%v", first[2])
			if k != "" && k != "<nil>" {
				topo.PartitionKey = k
			}
		}

		for _, row := range res.Rows {
			if len(row) < 6 {
				continue
			}
			pName := fmt.Sprintf("%v", row[0])
			if pName == "<nil>" || pName == "" {
				continue
			}
			desc := fmt.Sprintf("%v", row[3])
			bound := ""
			if desc != "<nil>" && desc != "" {
				bound = fmt.Sprintf("VALUES LESS THAN (%s)", desc)
			}
			rowsVal, _ := parseRowInt64(row[4])
			bytesVal, _ := parseRowInt64(row[5])

			topo.Partitions = append(topo.Partitions, PartitionNode{
				Name:            pName,
				Schema:          topo.Schema,
				ParentTable:     topo.ParentTable,
				BoundExpression: bound,
				PartitionType:   strings.ToLower(topo.Strategy),
				Rows:            rowsVal,
				Bytes:           bytesVal,
			})
		}
	}

	return nil
}

func inspectSQLiteTopology(ctx context.Context, drv types.Driver, topo *PartitionTopology) error {
	// Look for table chunks matching tbl or tbl_% or tbl_p%
	query := `
		SELECT name
		FROM sqlite_master
		WHERE type='table' AND (name = ? OR name LIKE ? OR name LIKE ?)
		ORDER BY name;
	`
	pattern1 := topo.ParentTable + `_%`
	pattern2 := topo.ParentTable + `_p%`
	res, err := drv.ExecuteRaw(ctx, query, topo.ParentTable, pattern1, pattern2)
	if err != nil {
		return err
	}

	var tables []string
	if res != nil {
		for _, row := range res.Rows {
			if len(row) > 0 {
				name := fmt.Sprintf("%v", row[0])
				if name != "<nil>" && name != "" {
					tables = append(tables, name)
				}
			}
		}
	}

	if len(tables) > 1 {
		topo.Strategy = "CHUNK"
		for _, t := range tables {
			if t == topo.ParentTable {
				continue
			}
			var rowCount int64
			cRes, cErr := drv.ExecuteRaw(ctx, fmt.Sprintf(`SELECT COUNT(*) FROM "%s"`, t))
			if cErr == nil && cRes != nil && len(cRes.Rows) > 0 && len(cRes.Rows[0]) > 0 {
				rowCount, _ = parseRowInt64(cRes.Rows[0][0])
			}
			// Estimate ~128 bytes per row if dbstat not enabled
			bytesVal := rowCount * 128
			if bytesVal == 0 {
				bytesVal = 4096
			}

			topo.Partitions = append(topo.Partitions, PartitionNode{
				Name:            t,
				Schema:          topo.Schema,
				ParentTable:     topo.ParentTable,
				BoundExpression: fmt.Sprintf("chunk pattern: %s", t),
				PartitionType:   "chunk",
				Rows:            rowCount,
				Bytes:           bytesVal,
			})
		}
	} else {
		topo.Strategy = "NONE"
	}

	return nil
}

func parseRowInt64(val interface{}) (int64, bool) {
	switch v := val.(type) {
	case int64:
		return v, true
	case int:
		return int64(v), true
	case int32:
		return int64(v), true
	case float64:
		return int64(v), true
	case string:
		n, err := strconv.ParseInt(v, 10, 64)
		return n, err == nil
	default:
		return 0, false
	}
}
