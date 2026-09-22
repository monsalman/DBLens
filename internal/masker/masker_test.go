package masker

import (
	"reflect"
	"strings"
	"testing"
)

func TestIsLuhnValid(t *testing.T) {
	// Valid Luhn numbers
	validCards := []string{
		"4532015112830366",
		"4532 0151 1283 0366",
		"4532-0151-1283-0366",
		"378282246310005",
	}
	for _, c := range validCards {
		if !IsLuhnValid(c) {
			t.Errorf("expected Luhn valid for %s, got false", c)
		}
	}

	// Invalid Luhn numbers
	invalidCards := []string{
		"4532015112830367",
		"1234",
		"abcdefghij123",
		"",
	}
	for _, c := range invalidCards {
		if IsLuhnValid(c) {
			t.Errorf("expected Luhn invalid for %s, got true", c)
		}
	}
}

func TestDetectPIIType(t *testing.T) {
	tests := []struct {
		colName  string
		sample   string
		expected string
	}{
		{"email", "", PIITypeEmail},
		{"user_email", "foo@bar.com", PIITypeEmail},
		{"notes", "contact@test.org", PIITypeEmail},
		{"phone", "", PIITypePhone},
		{"mobile_no", "+1 (555) 123-4567", PIITypePhone},
		{"untyped", "+12345678901", PIITypePhone},
		{"credit_card", "", PIITypeCard},
		{"custom", "4532015112830366", PIITypeCard},
		{"ssn", "", PIITypeSSN},
		{"national_id", "", PIITypeSSN},
		{"gov", "123-45-6789", PIITypeSSN},
		{"ip_address", "", PIITypeIP},
		{"host", "192.168.1.10", PIITypeIP},
		{"ipv6_node", "2001:0db8:85a3:0000:0000:8a2e:0370:7334", PIITypeIP},
		{"password", "my_secret", PIITypePassword},
		{"api_key", "secret-token-123", PIITypePassword},
		{"first_name", "Alice", PIITypeName},
		{"last_name", "Smith", PIITypeName},
		{"name", "John Doe", PIITypeName},
		{"full_name", "Jane Doe", PIITypeName},
		{"street", "123 Main St", PIITypeAddress},
		{"city", "Springfield", PIITypeAddress},
		// Non-PII cases
		{"id", "123", ""},
		{"table_name", "users", ""},
		{"column_name", "email", ""},
		{"filename", "photo.png", ""},
		{"created_at", "2026-01-01T00:00:00Z", ""},
		{"status", "active", ""},
		{"price", "99.99", ""},
		{"notes", strings.Repeat("a", 257) + "@example.com", ""},
	}

	for _, tt := range tests {
		got := DetectPIIType(tt.colName, tt.sample)
		if got != tt.expected {
			t.Errorf("DetectPIIType(%q, %q) = %q, expected %q", tt.colName, tt.sample, got, tt.expected)
		}
	}
}

func TestMaskValueStrategies(t *testing.T) {
	// 1. Redaction
	r1 := MaskValue("email", "alice@example.com", StrategyRedact)
	if r1 != "[REDACTED]" {
		t.Errorf("StrategyRedact failed, got: %v", r1)
	}

	// 2. Hash
	h1 := MaskValue("email", "alice@example.com", StrategyHash)
	hStr, ok := h1.(string)
	if !ok || !strings.HasPrefix(hStr, "hash_") {
		t.Errorf("StrategyHash failed, got: %v", h1)
	}

	// 3. Partial
	pEmail := MaskValue("email", "john.doe@example.com", StrategyPartial).(string)
	if !strings.HasPrefix(pEmail, "j***@") || !strings.HasSuffix(pEmail, "@example.com") {
		t.Errorf("StrategyPartial email unexpected: %s", pEmail)
	}

	pCard := MaskValue("card", "4532015112830366", StrategyPartial).(string)
	if !strings.HasSuffix(pCard, "0366") || !strings.Contains(pCard, "••••") {
		t.Errorf("StrategyPartial card unexpected: %s", pCard)
	}

	pPhone := MaskValue("phone", "+1 555 123 4567", StrategyPartial).(string)
	if !strings.HasSuffix(pPhone, "4567") || !strings.Contains(pPhone, "•••") {
		t.Errorf("StrategyPartial phone unexpected: %s", pPhone)
	}

	pSSN := MaskValue("ssn", "123-45-6789", StrategyPartial).(string)
	if pSSN != "•••-••-6789" {
		t.Errorf("StrategyPartial ssn unexpected: %s", pSSN)
	}

	pName := MaskValue("name", "Alice Wonderland", StrategyPartial).(string)
	if !strings.Contains(pName, "A***e") || !strings.Contains(pName, "W***d") {
		t.Errorf("StrategyPartial name unexpected: %s", pName)
	}

	pPass := MaskValue("password", "supersecret123", StrategyPartial).(string)
	if pPass != "••••••••" {
		t.Errorf("StrategyPartial password unexpected: %s", pPass)
	}

	// 4. Faker
	fName := MaskValue("name", "John Smith", StrategyFaker).(string)
	if fName == "John Smith" || !strings.Contains(fName, " ") {
		t.Errorf("StrategyFaker name unexpected: %s", fName)
	}

	fEmail := MaskValue("email", "john.doe@example.com", StrategyFaker).(string)
	if !strings.Contains(fEmail, "@") {
		t.Errorf("StrategyFaker email unexpected: %s", fEmail)
	}

	fCard := MaskValue("card", "4532015112830366", StrategyFaker).(string)
	if !IsLuhnValid(fCard) {
		t.Errorf("StrategyFaker card is not valid Luhn: %s", fCard)
	}
}

func TestDeterministicFakerStability(t *testing.T) {
	inputVal := "corporate.vip@bigcorp.io"
	first := MaskValue("email", inputVal, StrategyFaker)

	for i := 0; i < 20; i++ {
		repeat := MaskValue("email", inputVal, StrategyFaker)
		if repeat != first {
			t.Fatalf("Faker is not deterministic! First: %v, Repeat %d: %v", first, i, repeat)
		}
	}

	nameVal := "Sarah Connor"
	firstName := MaskValue("name", nameVal, StrategyFaker)
	for i := 0; i < 20; i++ {
		repeatName := MaskValue("name", nameVal, StrategyFaker)
		if repeatName != firstName {
			t.Fatalf("Faker name is not deterministic! First: %v, Repeat %d: %v", firstName, i, repeatName)
		}
	}
}

func TestNilEmptySpecialChars(t *testing.T) {
	// Nil input
	if got := MaskValue("email", nil, StrategyPartial); got != nil {
		t.Errorf("expected nil for nil input, got: %v", got)
	}

	// Empty string input
	if got := MaskValue("email", "", StrategyPartial); got != "" {
		t.Errorf("expected empty string for empty input, got: %v", got)
	}

	// Non-PII column should return untouched value
	if got := MaskValue("status", "pending", StrategyPartial); got != "pending" {
		t.Errorf("expected untouched status, got: %v", got)
	}

	// Special chars in name
	specialName := MaskValue("name", "A B C", StrategyPartial).(string)
	if specialName == "" {
		t.Errorf("expected masked special name, got empty")
	}

	// Unicode characters
	unicodeName := MaskValue("name", "José Müller", StrategyPartial).(string)
	if !strings.Contains(unicodeName, "***") {
		t.Errorf("expected masked unicode name, got: %s", unicodeName)
	}
}

func TestMaskRecord(t *testing.T) {
	cols := []string{"id", "email", "name", "price"}
	record := []string{"101", "test@domain.com", "Alice Brown", "45.00"}

	masked := MaskRecord(cols, record, StrategyRedact)
	expected := []string{"101", "[REDACTED]", "[REDACTED]", "45.00"}
	if !reflect.DeepEqual(masked, expected) {
		t.Errorf("MaskRecord mismatch.\nGot:      %v\nExpected: %v", masked, expected)
	}

	maskedPartial := MaskRecord(cols, record, StrategyPartial)
	if maskedPartial[0] != "101" || maskedPartial[3] != "45.00" {
		t.Errorf("non-PII columns modified in MaskRecord: %v", maskedPartial)
	}
	if !strings.Contains(maskedPartial[1], "***@domain.com") {
		t.Errorf("expected partial email mask, got: %s", maskedPartial[1])
	}
}
