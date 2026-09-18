package sqlite_test

import (
	"context"
	"os"
	"testing"

	"github.com/dblens/dblens/internal/driver/sqlite"
)

func TestSQLiteGetERDDataCardinality(t *testing.T) {
	dbFile := "/tmp/dblens_sqlite_erd_cardinality_test.db"
	_ = os.Remove(dbFile)
	defer os.Remove(dbFile)

	dsn := "sqlite://" + dbFile
	drv, err := sqlite.New(dsn)
	if err != nil {
		t.Fatalf("failed to create sqlite driver: %v", err)
	}
	defer drv.Close()

	ctx := context.Background()
	_, err = drv.ExecuteQuery(ctx, `
		CREATE TABLE users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT NOT NULL
		);

		CREATE TABLE orders (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			total REAL NOT NULL,
			FOREIGN KEY (user_id) REFERENCES users(id)
		);

		CREATE TABLE profiles (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL UNIQUE,
			bio TEXT,
			FOREIGN KEY (user_id) REFERENCES users(id)
		);
	`)
	if err != nil {
		t.Fatalf("failed to create schema: %v", err)
	}

	erd, err := drv.GetERDData(ctx)
	if err != nil {
		t.Fatalf("failed to get ERD data: %v", err)
	}

	if len(erd) < 3 {
		t.Fatalf("expected at least 3 tables, got %d", len(erd))
	}

	var foundOrders, foundProfiles bool
	for _, tbl := range erd {
		if tbl.Name == "orders" {
			foundOrders = true
			if len(tbl.FKs) != 1 {
				t.Fatalf("expected 1 FK on orders, got %d", len(tbl.FKs))
			}
			if tbl.FKs[0].Cardinality != "1:N" {
				t.Fatalf("expected orders FK cardinality to be '1:N', got '%s'", tbl.FKs[0].Cardinality)
			}
		}
		if tbl.Name == "profiles" {
			foundProfiles = true
			if len(tbl.FKs) != 1 {
				t.Fatalf("expected 1 FK on profiles, got %d", len(tbl.FKs))
			}
			if tbl.FKs[0].Cardinality != "1:1" {
				t.Fatalf("expected profiles FK cardinality to be '1:1', got '%s'", tbl.FKs[0].Cardinality)
			}
		}
	}

	if !foundOrders || !foundProfiles {
		t.Fatalf("expected both orders and profiles to be in ERD data, foundOrders=%v, foundProfiles=%v", foundOrders, foundProfiles)
	}
}

func TestSQLiteInspectHealth(t *testing.T) {
	dbFile := "/tmp/dblens_sqlite_health_test.db"
	_ = os.Remove(dbFile)
	defer os.Remove(dbFile)

	dsn := "sqlite://" + dbFile
	drv, err := sqlite.New(dsn)
	if err != nil {
		t.Fatalf("failed to create sqlite driver: %v", err)
	}
	defer drv.Close()

	ctx := context.Background()
	_, err = drv.ExecuteQuery(ctx, `
		CREATE TABLE metrics (
			id INTEGER PRIMARY KEY,
			val TEXT
		);
		INSERT INTO metrics (val) VALUES ('a'), ('b'), ('c');
	`)
	if err != nil {
		t.Fatalf("failed to initialize db: %v", err)
	}

	report, err := drv.InspectHealth(ctx)
	if err != nil {
		t.Fatalf("InspectHealth failed: %v", err)
	}

	if report.TotalTables != 1 {
		t.Fatalf("expected 1 table, got %d", report.TotalTables)
	}
	if report.DatabaseSizeBytes <= 0 {
		t.Fatalf("expected positive database size bytes, got %d", report.DatabaseSizeBytes)
	}
	if report.CacheHitRatio < 0 || report.CacheHitRatio > 100 {
		t.Fatalf("expected cache hit ratio between 0 and 100, got %f", report.CacheHitRatio)
	}
	if len(report.Recommendations) == 0 {
		t.Fatalf("expected recommendations, got 0")
	}
}

