package api_test

import (
	"testing"

	"github.com/dblens/dblens/internal/api"
)

func TestMaskDSN(t *testing.T) {
	cases := []struct {
		input    string
		expected string
	}{
		{
			input:    "mysql://root:***@tcp(localhost:3306)/dbname",
			expected: "mysql://root:***@tcp(localhost:3306)/dbname",
		},
		{
			input:    "root:secret@tcp(localhost:3306)/dbname",
			expected: "root:***@tcp(localhost:3306)/dbname",
		},
		{
			input:    "postgres://user:***@localhost:5432/db",
			expected: "postgres://user:***@localhost:5432/db",
		},
		{
			input:    "root@tcp(localhost:3306)/dbname",
			expected: "root@tcp(localhost:3306)/dbname",
		},
		{
			input:    "sqlite:///data/test.db",
			expected: "sqlite:///data/test.db",
		},
		{
			input:    "postgres://user:p@ss@w0rd@localhost:5432/db",
			expected: "postgres://user:***@localhost:5432/db",
		},
		{
			input:    "root:p@ss@word@tcp(localhost:3306)/dbname",
			expected: "root:***@tcp(localhost:3306)/dbname",
		},
		{
			input:    "mysql://root:p@ss@word@tcp(localhost:3306)/dbname",
			expected: "mysql://root:***@tcp(localhost:3306)/dbname",
		},
		{
			input:    "user:pass:word@tcp(localhost:3306)/dbname",
			expected: "user:***@tcp(localhost:3306)/dbname",
		},
		{
			input:    "postgres://user:secret@localhost:5432/db?email=foo@bar.com",
			expected: "postgres://user:***@localhost:5432/db?email=foo@bar.com",
		},
		{
			input:    "oracle://scott:tiger@localhost:1521/xe",
			expected: "oracle://scott:***@localhost:1521/xe",
		},
		{
			input:    "postgres://user@localhost:5432/db",
			expected: "postgres://user@localhost:5432/db",
		},
		{
			input:    ":memory:",
			expected: ":memory:",
		},
	}

	for _, tc := range cases {
		got := api.MaskDSN(tc.input)
		if got != tc.expected {
			t.Errorf("MaskDSN(%q) = %q, want %q", tc.input, got, tc.expected)
		}
	}
}
