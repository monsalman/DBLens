package masker

import (
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"net"
	"regexp"
	"strings"
	"time"
	"unicode"
)

type Strategy string

const (
	StrategyPartial Strategy = "partial"
	StrategyRedact  Strategy = "redact"
	StrategyHash    Strategy = "hash"
	StrategyFaker   Strategy = "faker"
)

const (
	PIITypeEmail    = "email"
	PIITypePhone    = "phone"
	PIITypeCard     = "card"
	PIITypeSSN      = "ssn"
	PIITypePassword = "password"
	PIITypeName     = "name"
	PIITypeAddress  = "address"
	PIITypeIP       = "ip"
)

var (
	// RFC 5322 simplified email regex
	rfc5322EmailRegex = regexp.MustCompile(`^[a-zA-Z0-9.!#$%&'*+/=?^_` + "`" + `{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$`)
	// SSN format: 000-00-0000
	ssnRegex = regexp.MustCompile(`^\d{3}-\d{2}-\d{4}$`)
	// Basic phone format with dashes, spaces, parens, or plus
	phoneCharsRegex = regexp.MustCompile(`^\+?[0-9\s\-().]{7,25}$`)
)

var (
	fakerFirstNames = []string{
		"James", "Mary", "John", "Patricia", "Robert", "Jennifer", "Michael", "Linda",
		"William", "Elizabeth", "David", "Barbara", "Richard", "Susan", "Joseph", "Jessica",
		"Thomas", "Sarah", "Charles", "Karen", "Christopher", "Nancy", "Daniel", "Lisa",
		"Matthew", "Betty", "Anthony", "Margaret", "Mark", "Sandra",
	}
	fakerLastNames = []string{
		"Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
		"Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson",
		"Thomas", "Taylor", "Moore", "Jackson", "Martin",
	}
	fakerUsernames = []string{
		"alex", "jordan", "taylor", "morgan", "sam", "chris", "pat", "casey",
		"riley", "jamie", "cameron", "dakota", "avery", "reese", "quinn",
	}
	fakerDomains = []string{
		"example.com", "example.org", "sample.net", "testmail.com", "mockdata.io",
	}
	fakerStreets = []string{
		"Oak St", "Maple Ave", "Pine St", "Cedar Ln", "Elm St", "Washington Blvd", "Main St", "Lakeview Dr",
	}
	fakerCities = []string{
		"Springfield", "Riverdale", "Franklin", "Clinton", "Georgetown", "Madison", "Salem", "Fairview",
	}
	fakerStates = []string{
		"IL", "CA", "NY", "TX", "WA", "OH", "FL", "PA",
	}
)

// IsLuhnValid validates credit card numbers using Luhn checksum (13-19 digits).
func IsLuhnValid(s string) bool {
	var digits []int
	for _, r := range s {
		if r >= '0' && r <= '9' {
			digits = append(digits, int(r-'0'))
		} else if r != ' ' && r != '-' {
			return false
		}
	}
	if len(digits) < 13 || len(digits) > 19 {
		return false
	}
	var sum int
	alternate := false
	for i := len(digits) - 1; i >= 0; i-- {
		d := digits[i]
		if alternate {
			d *= 2
			if d > 9 {
				d -= 9
			}
		}
		sum += d
		alternate = !alternate
	}
	return sum%10 == 0
}

func isIP(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" {
		return false
	}
	ip := net.ParseIP(s)
	if ip == nil {
		return false
	}
	return strings.Contains(s, ".") || strings.Contains(s, ":")
}

func isPhone(s string) bool {
	s = strings.TrimSpace(s)
	if len(s) < 7 || len(s) > 25 {
		return false
	}
	// Exclude ISO dates (e.g. 2026-01-01) and timestamps
	if len(s) >= 10 && (s[4] == '-' || s[4] == '/') && (s[7] == '-' || s[7] == '/') {
		return false
	}
	if !phoneCharsRegex.MatchString(s) {
		return false
	}
	var digits int
	for _, r := range s {
		if r >= '0' && r <= '9' {
			digits++
		}
	}
	return digits >= 7 && digits <= 15
}

func detectColumnPII(colName string) string {
	norm := strings.ToLower(strings.TrimSpace(colName))
	norm = strings.ReplaceAll(norm, "-", "_")
	norm = strings.ReplaceAll(norm, " ", "_")

	if strings.Contains(norm, "email") || strings.Contains(norm, "e_mail") || strings.Contains(norm, "mail_addr") {
		return PIITypeEmail
	}

	if strings.Contains(norm, "phone") || strings.Contains(norm, "mobile") || strings.Contains(norm, "telephone") ||
		strings.Contains(norm, "tel_no") || strings.Contains(norm, "cellphone") || strings.Contains(norm, "cell_no") ||
		strings.Contains(norm, "msisdn") || norm == "tel" || norm == "cell" {
		return PIITypePhone
	}

	if strings.Contains(norm, "card_no") || strings.Contains(norm, "card_num") || strings.Contains(norm, "card_number") ||
		strings.Contains(norm, "credit_card") || strings.Contains(norm, "debit_card") || strings.Contains(norm, "cc_num") ||
		strings.Contains(norm, "pan") || strings.Contains(norm, "cvv") || strings.Contains(norm, "cvc") ||
		norm == "card" || norm == "cc" {
		return PIITypeCard
	}

	if strings.Contains(norm, "ssn") || strings.Contains(norm, "social_security") || strings.Contains(norm, "national_id") ||
		strings.Contains(norm, "nik") || strings.Contains(norm, "passport") || strings.Contains(norm, "tax_id") ||
		strings.Contains(norm, "gov_id") {
		return PIITypeSSN
	}

	if strings.Contains(norm, "password") || strings.Contains(norm, "passwd") || strings.Contains(norm, "secret") ||
		strings.Contains(norm, "api_key") || strings.Contains(norm, "apikey") || strings.Contains(norm, "access_token") ||
		strings.Contains(norm, "auth_token") || strings.Contains(norm, "token") || strings.Contains(norm, "private_key") {
		return PIITypePassword
	}

	if strings.Contains(norm, "ip_address") || strings.Contains(norm, "ip_addr") || strings.Contains(norm, "client_ip") ||
		strings.Contains(norm, "remote_ip") || strings.Contains(norm, "user_ip") || norm == "ip" || norm == "ipv4" || norm == "ipv6" {
		return PIITypeIP
	}

	if strings.Contains(norm, "address") || strings.Contains(norm, "street") || strings.Contains(norm, "zipcode") ||
		strings.Contains(norm, "zip_code") || strings.Contains(norm, "postal_code") || strings.Contains(norm, "postcode") ||
		norm == "zip" || norm == "city" || norm == "state" || norm == "country" || norm == "addr" {
		return PIITypeAddress
	}

	// Name heuristics - avoid technical words like filename, tablename, colname
	if norm == "name" || norm == "fullname" || norm == "full_name" || norm == "firstname" || norm == "first_name" ||
		norm == "lastname" || norm == "last_name" || norm == "surname" || norm == "forename" || norm == "username" ||
		norm == "user_name" || norm == "customer_name" || norm == "client_name" || norm == "contact_name" ||
		norm == "patient_name" || norm == "owner_name" || norm == "display_name" {
		return PIITypeName
	}

	if strings.HasSuffix(norm, "_name") {
		techPrefixes := map[string]bool{
			"table": true, "column": true, "file": true, "class": true, "db": true,
			"database": true, "schema": true, "host": true, "index": true, "metric": true,
			"type": true, "attr": true, "var": true, "field": true, "component": true,
			"module": true, "domain": true, "key": true, "package": true, "dir": true,
		}
		prefix := strings.TrimSuffix(norm, "_name")
		if !techPrefixes[prefix] {
			return PIITypeName
		}
	}

	return ""
}

// DetectPIIType returns detected PII category ("email", "phone", "card", "ssn", "password", "name", "address", "ip") or empty string.
func DetectPIIType(colName string, sampleValue string) string {
	val := strings.TrimSpace(sampleValue)

	// 1. High-confidence value heuristics
	if val != "" {
		if rfc5322EmailRegex.MatchString(val) {
			return PIITypeEmail
		}
		if IsLuhnValid(val) {
			return PIITypeCard
		}
		if ssnRegex.MatchString(val) {
			return PIITypeSSN
		}
		if isIP(val) {
			return PIITypeIP
		}
	}

	// 2. Column name heuristics
	colPII := detectColumnPII(colName)
	if colPII != "" {
		return colPII
	}

	// 3. Phone value heuristics
	if val != "" && isPhone(val) {
		return PIITypePhone
	}

	return ""
}

func generateFakerCard(seed uint64) string {
	body := fmt.Sprintf("4532%011d", seed%100000000000)
	var sum int
	for i := 0; i < 15; i++ {
		d := int(body[i] - '0')
		if i%2 == 0 {
			d *= 2
			if d > 9 {
				d -= 9
			}
		}
		sum += d
	}
	checkDigit := (10 - (sum % 10)) % 10
	full := fmt.Sprintf("%s%d", body, checkDigit)
	return fmt.Sprintf("%s %s %s %s", full[0:4], full[4:8], full[8:12], full[12:16])
}

func maskPartial(piiType string, val string) string {
	switch piiType {
	case PIITypeEmail:
		parts := strings.SplitN(val, "@", 2)
		if len(parts) != 2 {
			runes := []rune(val)
			if len(runes) <= 2 {
				return "***"
			}
			return string(runes[0]) + "***"
		}
		local := parts[0]
		domain := parts[1]
		if len(local) <= 1 {
			return local + "***@" + domain
		}
		runes := []rune(local)
		return string(runes[0]) + "***@" + domain

	case PIITypeCard:
		var digits []rune
		for _, r := range val {
			if unicode.IsDigit(r) {
				digits = append(digits, r)
			}
		}
		if len(digits) >= 4 {
			last4 := string(digits[len(digits)-4:])
			return "•••• •••• •••• " + last4
		}
		return "•••• •••• •••• ••••"

	case PIITypePhone:
		var digits []rune
		for _, r := range val {
			if unicode.IsDigit(r) {
				digits = append(digits, r)
			}
		}
		hasPlus := strings.HasPrefix(strings.TrimSpace(val), "+")
		if len(digits) >= 4 {
			last4 := string(digits[len(digits)-4:])
			if hasPlus {
				return "+1 ••• ••• " + last4
			}
			return "••• ••• " + last4
		}
		return "+1 ••• ••• ••••"

	case PIITypeSSN:
		var digits []rune
		for _, r := range val {
			if unicode.IsDigit(r) {
				digits = append(digits, r)
			}
		}
		if len(digits) >= 4 {
			last4 := string(digits[len(digits)-4:])
			return "•••-••-" + last4
		}
		return "•••-••-••••"

	case PIITypePassword:
		return "••••••••"

	case PIITypeIP:
		if strings.Contains(val, ".") {
			parts := strings.Split(val, ".")
			if len(parts) >= 2 {
				return parts[0] + "." + parts[1] + ".•••.•••"
			}
		}
		if strings.Contains(val, ":") {
			parts := strings.Split(val, ":")
			if len(parts) > 0 {
				return parts[0] + ":••••:••••:••••"
			}
		}
		return "•••.•••.•••.•••"

	case PIITypeName:
		words := strings.Fields(val)
		if len(words) == 0 {
			return "***"
		}
		maskedWords := make([]string, len(words))
		for i, w := range words {
			runes := []rune(w)
			if len(runes) <= 1 {
				maskedWords[i] = string(runes) + "*"
			} else if len(runes) == 2 {
				maskedWords[i] = string(runes[0]) + "*"
			} else {
				maskedWords[i] = string(runes[0]) + "***" + string(runes[len(runes)-1])
			}
		}
		return strings.Join(maskedWords, " ")

	case PIITypeAddress:
		words := strings.Fields(val)
		if len(words) > 1 {
			return words[0] + " ••• [REDACTED]"
		}
		return "••• [REDACTED]"

	default:
		runes := []rune(val)
		if len(runes) <= 2 {
			return strings.Repeat("*", len(runes))
		}
		return string(runes[0]) + "***" + string(runes[len(runes)-1])
	}
}

func maskFaker(piiType string, val string) string {
	h := sha256.Sum256([]byte("dblens_faker_seed_" + val))
	seed := binary.BigEndian.Uint64(h[:8])

	switch piiType {
	case PIITypeName:
		fn := fakerFirstNames[seed%uint64(len(fakerFirstNames))]
		ln := fakerLastNames[(seed>>8)%uint64(len(fakerLastNames))]
		return fn + " " + ln

	case PIITypeEmail:
		un := fakerUsernames[seed%uint64(len(fakerUsernames))]
		num := (seed>>8)%900 + 100
		dom := fakerDomains[(seed>>16)%uint64(len(fakerDomains))]
		return fmt.Sprintf("%s%d@%s", un, num, dom)

	case PIITypePhone:
		return fmt.Sprintf("+1-555-%04d", seed%10000)

	case PIITypeCard:
		return generateFakerCard(seed)

	case PIITypeSSN:
		return fmt.Sprintf("9%02d-%02d-%04d", seed%90+10, (seed>>8)%90+10, (seed>>16)%9000+1000)

	case PIITypeAddress:
		num := (seed % 900) + 100
		st := fakerStreets[(seed>>8)%uint64(len(fakerStreets))]
		city := fakerCities[(seed>>16)%uint64(len(fakerCities))]
		state := fakerStates[(seed>>24)%uint64(len(fakerStates))]
		zip := (seed>>32)%90000 + 10000
		return fmt.Sprintf("%d %s, %s, %s %05d", num, st, city, state, zip)

	case PIITypeIP:
		return fmt.Sprintf("192.0.2.%d", (seed%250)+1)

	case PIITypePassword:
		return fmt.Sprintf("tok_%08x", seed&0xffffffff)

	default:
		return fmt.Sprintf("synthetic_%08x", seed&0xffffffff)
	}
}

// MaskValue masks an individual value according to colName and Strategy.
// ponytail: stdlib static faker dictionaries cover basic PII types; upgrade to dynamic locales if multi-region requested.
func MaskValue(colName string, val interface{}, strategy Strategy) interface{} {
	if val == nil {
		return nil
	}
	if strategy == "" {
		strategy = StrategyPartial
	}

	var strVal string
	switch v := val.(type) {
	case string:
		strVal = v
	case []byte:
		strVal = string(v)
	case time.Time:
		strVal = v.Format(time.RFC3339)
	default:
		strVal = fmt.Sprintf("%v", v)
	}

	if strVal == "" {
		return val
	}

	piiType := DetectPIIType(colName, strVal)
	if piiType == "" {
		return val
	}

	switch strategy {
	case StrategyRedact:
		return "[REDACTED]"

	case StrategyHash:
		h := sha256.Sum256([]byte("dblens_salt_" + strVal))
		return fmt.Sprintf("hash_%x", h[:8])

	case StrategyFaker:
		return maskFaker(piiType, strVal)

	case StrategyPartial:
		fallthrough
	default:
		return maskPartial(piiType, strVal)
	}
}

// MaskRecord masks a CSV/streaming record slice of strings.
func MaskRecord(cols []string, record []string, strategy Strategy) []string {
	masked := make([]string, len(record))
	for i := range record {
		col := ""
		if i < len(cols) {
			col = cols[i]
		}
		val := record[i]
		if val == "" {
			masked[i] = ""
			continue
		}
		piiType := DetectPIIType(col, val)
		if piiType == "" {
			masked[i] = val
		} else {
			m := MaskValue(col, val, strategy)
			if s, ok := m.(string); ok {
				masked[i] = s
			} else {
				masked[i] = fmt.Sprintf("%v", m)
			}
		}
	}
	return masked
}
