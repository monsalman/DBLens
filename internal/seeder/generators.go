package seeder

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/dblens/dblens/internal/driver/types"
)

type GeneratorType string

const (
	GenName        GeneratorType = "name"
	GenFirstName   GeneratorType = "first_name"
	GenLastName    GeneratorType = "last_name"
	GenEmail       GeneratorType = "email"
	GenUUID        GeneratorType = "uuid"
	GenPhone       GeneratorType = "phone"
	GenAddress     GeneratorType = "address"
	GenCity        GeneratorType = "city"
	GenCountry     GeneratorType = "country"
	GenPostalCode  GeneratorType = "postal_code"
	GenTimestamp   GeneratorType = "timestamp"
	GenDate        GeneratorType = "date"
	GenInteger     GeneratorType = "integer"
	GenSequence    GeneratorType = "sequence"
	GenDecimal     GeneratorType = "decimal"
	GenBoolean     GeneratorType = "boolean"
	GenEnum        GeneratorType = "enum"
	GenText        GeneratorType = "text"
	GenParagraph   GeneratorType = "paragraph"
	GenJSON        GeneratorType = "json"
	GenFK          GeneratorType = "fk"
	GenCustom      GeneratorType = "custom"
)

type GeneratorConfig struct {
	Type     GeneratorType `json:"type"`
	Min      int64         `json:"min,omitempty"`
	Max      int64         `json:"max,omitempty"`
	Decimals int           `json:"decimals,omitempty"`
	Options  []string      `json:"options,omitempty"`
	Prefix   string        `json:"prefix,omitempty"`
	TruePct  int           `json:"truePct,omitempty"`
}

var firstNames = []string{
	"Alex", "Alice", "Amara", "Arthur", "Benjamin", "Chloe", "Daniel", "David",
	"Elena", "Emma", "Ethan", "Felix", "Grace", "Hannah", "Henry", "Isabella",
	"Jack", "James", "Julia", "Leo", "Liam", "Lucas", "Maya", "Michael",
	"Noah", "Nora", "Oliver", "Olivia", "Rachel", "Samuel", "Sarah", "Sophia",
	"Thomas", "Victor", "William", "Zoe",
}

var lastNames = []string{
	"Adams", "Baker", "Brown", "Clark", "Davis", "Evans", "Fisher", "Garcia",
	"Harris", "Hill", "Jackson", "Johnson", "Jones", "King", "Lee", "Lewis",
	"Martin", "Miller", "Moore", "Nelson", "Parker", "Patel", "Reed", "Roberts",
	"Scott", "Smith", "Taylor", "Thomas", "Walker", "White", "Williams", "Wilson",
}

var emailDomains = []string{
	"example.com", "testcorp.io", "devmail.org", "sampleapp.net", "cloudteam.dev",
}

var streetNames = []string{
	"Main St", "Market St", "Oak Ave", "Pine St", "Maple Blvd", "Cedar Lane",
	"Elm St", "Park Ave", "Washington Way", "Lakeview Dr", "Sunset Blvd",
}

var cityNames = []string{
	"New York", "San Francisco", "London", "Tokyo", "Berlin", "Toronto",
	"Sydney", "Singapore", "Paris", "Austin", "Amsterdam", "Dublin",
}

var countryNames = []string{
	"United States", "United Kingdom", "Germany", "Japan", "Canada",
	"Australia", "France", "Netherlands", "Singapore", "Ireland",
}

var statusEnums = []string{
	"active", "pending", "completed", "archived", "suspended",
}

var roleEnums = []string{
	"admin", "editor", "viewer", "guest", "operator",
}

var priorityEnums = []string{
	"low", "medium", "high", "critical",
}

var sampleWords = []string{
	"lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "adipiscing",
	"elit", "sed", "do", "eiusmod", "tempor", "incididunt", "ut", "labore",
	"et", "dolore", "magna", "aliqua", "enim", "ad", "minim", "veniam",
	"quis", "nostrud", "exercitation", "ullamco", "laboris", "nisi", "ut",
	"aliquip", "ex", "ea", "commodo", "consequat", "duis", "aute", "irure",
}

// DataGenerator generates deterministic synthetic data.
type DataGenerator struct {
	rng  *rand.Rand
	seq  int64
	mu   sync.Mutex
	seqs map[int64]*int64
}

// NewDataGenerator initializes a generator with a reproducible seed.
func NewDataGenerator(seed int64) *DataGenerator {
	if seed == 0 {
		seed = 42
	}
	return &DataGenerator{
		rng:  rand.New(rand.NewSource(seed)),
		seq:  0,
		seqs: make(map[int64]*int64),
	}
}

// SetSequence sets the current sequence counter.
func (g *DataGenerator) SetSequence(val int64) {
	atomic.StoreInt64(&g.seq, val)
}

// NextSequence increments and returns the next sequential integer.
func (g *DataGenerator) NextSequence() int64 {
	return atomic.AddInt64(&g.seq, 1)
}

// NextSequenceWithStart increments and returns the next sequential integer starting at start.
func (g *DataGenerator) NextSequenceWithStart(start int64) int64 {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.seqs == nil {
		g.seqs = make(map[int64]*int64)
	}
	ptr, ok := g.seqs[start]
	if !ok {
		val := start
		g.seqs[start] = &val
		return val
	}
	*ptr++
	return *ptr
}

// GenerateValue produces a synthetic value conforming to config.
func (g *DataGenerator) GenerateValue(cfg GeneratorConfig) interface{} {
	switch cfg.Type {
	case GenName:
		f := firstNames[g.rng.Intn(len(firstNames))]
		l := lastNames[g.rng.Intn(len(lastNames))]
		return f + " " + l

	case GenFirstName:
		return firstNames[g.rng.Intn(len(firstNames))]

	case GenLastName:
		return lastNames[g.rng.Intn(len(lastNames))]

	case GenEmail:
		f := strings.ToLower(firstNames[g.rng.Intn(len(firstNames))])
		l := strings.ToLower(lastNames[g.rng.Intn(len(lastNames))])
		d := emailDomains[g.rng.Intn(len(emailDomains))]
		num := g.rng.Intn(999) + 1
		return fmt.Sprintf("%s.%s%d@%s", f, l, num, d)

	case GenUUID:
		var b [16]byte
		for i := 0; i < 16; i++ {
			b[i] = byte(g.rng.Intn(256))
		}
		b[6] = (b[6] & 0x0f) | 0x40 // Version 4
		b[8] = (b[8] & 0x3f) | 0x80 // Variant RFC 4122
		return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])

	case GenPhone:
		area := g.rng.Intn(800) + 200
		mid := g.rng.Intn(900) + 100
		tail := g.rng.Intn(9000) + 1000
		return fmt.Sprintf("+1-%03d-%03d-%04d", area, mid, tail)

	case GenAddress:
		num := g.rng.Intn(9999) + 1
		st := streetNames[g.rng.Intn(len(streetNames))]
		city := cityNames[g.rng.Intn(len(cityNames))]
		return fmt.Sprintf("%d %s, %s", num, st, city)

	case GenCity:
		return cityNames[g.rng.Intn(len(cityNames))]

	case GenCountry:
		return countryNames[g.rng.Intn(len(countryNames))]

	case GenPostalCode:
		return fmt.Sprintf("%05d", g.rng.Intn(90000)+10000)

	case GenTimestamp:
		// Timestamp within past 2 years up to current reference time
		base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
		offsetSec := g.rng.Int63n(60 * 86400) // Within ~60 days
		t := base.Add(time.Duration(offsetSec) * time.Second)
		return t.Format(time.RFC3339)

	case GenDate:
		base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
		offsetDays := g.rng.Intn(365)
		d := base.AddDate(0, 0, offsetDays)
		return d.Format("2006-01-02")

	case GenInteger:
		minVal := cfg.Min
		maxVal := cfg.Max
		if minVal == 0 && maxVal == 0 {
			minVal = 1
			maxVal = 10000
		}
		if maxVal < minVal {
			maxVal = minVal + 100
		}
		diff := maxVal - minVal + 1
		if diff <= 0 {
			diff = 10000
		}
		return minVal + g.rng.Int63n(diff)

	case GenSequence:
		if cfg.Min > 0 {
			return g.NextSequenceWithStart(cfg.Min)
		}
		return g.NextSequence()

	case GenDecimal:
		minVal := float64(cfg.Min)
		maxVal := float64(cfg.Max)
		if minVal == 0 && maxVal == 0 {
			minVal = 5.0
			maxVal = 1000.0
		}
		if maxVal <= minVal {
			maxVal = minVal + 100.0
		}
		val := minVal + g.rng.Float64()*(maxVal-minVal)
		decs := cfg.Decimals
		if decs <= 0 {
			decs = 2
		}
		if decs > 10 {
			decs = 10
		}
		formatStr := fmt.Sprintf("%%.%df", decs)
		resStr := fmt.Sprintf(formatStr, val)
		return resStr

	case GenBoolean:
		pct := cfg.TruePct
		if pct <= 0 {
			pct = 50
		}
		return g.rng.Intn(100) < pct

	case GenEnum:
		opts := cfg.Options
		if len(opts) == 0 {
			opts = statusEnums
		}
		return opts[g.rng.Intn(len(opts))]

	case GenText:
		wordCount := g.rng.Intn(4) + 3
		words := make([]string, wordCount)
		for i := 0; i < wordCount; i++ {
			w := sampleWords[g.rng.Intn(len(sampleWords))]
			if i == 0 {
				w = strings.ToUpper(w[:1]) + w[1:]
			}
			words[i] = w
		}
		return strings.Join(words, " ")

	case GenParagraph:
		sentenceCount := g.rng.Intn(3) + 2
		sentences := make([]string, sentenceCount)
		for s := 0; s < sentenceCount; s++ {
			wc := g.rng.Intn(6) + 4
			words := make([]string, wc)
			for i := 0; i < wc; i++ {
				w := sampleWords[g.rng.Intn(len(sampleWords))]
				if i == 0 {
					w = strings.ToUpper(w[:1]) + w[1:]
				}
				words[i] = w
			}
			sentences[s] = strings.Join(words, " ") + "."
		}
		return strings.Join(sentences, " ")

	case GenJSON:
		payload := map[string]interface{}{
			"id":       g.rng.Intn(1000) + 1,
			"status":   statusEnums[g.rng.Intn(len(statusEnums))],
			"verified": g.rng.Intn(2) == 1,
			"score":    float64(g.rng.Intn(100)) + 0.5,
			"tags":     []string{"synth", "fixture", "v1"},
		}
		b, _ := json.Marshal(payload)
		return string(b)

	case GenCustom:
		if cfg.Prefix != "" {
			return fmt.Sprintf("%s_%d", cfg.Prefix, g.rng.Intn(9999)+1)
		}
		return fmt.Sprintf("custom_%d", g.rng.Intn(9999)+1)

	default:
		return fmt.Sprintf("val_%d", g.rng.Intn(1000)+1)
	}
}

var (
	reEmail     = regexp.MustCompile(`(?i)email|e_mail|mail`)
	reFirstName = regexp.MustCompile(`(?i)first_?name|given_?name`)
	reLastName  = regexp.MustCompile(`(?i)last_?name|surname|family_?name`)
	reName      = regexp.MustCompile(`(?i)full_?name|username|author_?name|contact_?name|^name$`)
	rePhone     = regexp.MustCompile(`(?i)phone|mobile|cell|telephone|fax`)
	reAddress   = regexp.MustCompile(`(?i)address|street|addr`)
	reCity      = regexp.MustCompile(`(?i)city|town`)
	reCountry   = regexp.MustCompile(`(?i)country|nation`)
	rePostal    = regexp.MustCompile(`(?i)zip|postal|postcode`)
	reUUID      = regexp.MustCompile(`(?i)uuid|guid`)
	reTimestamp = regexp.MustCompile(`(?i)created_?at|updated_?at|deleted_?at|timestamp|datetime`)
	reDate      = regexp.MustCompile(`(?i)birth_?date|dob|expire_?date|due_?date|^date$`)
	reBoolean   = regexp.MustCompile(`(?i)^is_|^has_|^can_|active|enabled|flag|verified|deleted|archived`)
	reStatus    = regexp.MustCompile(`(?i)status|state|lifecycle`)
	reRole      = regexp.MustCompile(`(?i)role|permission|tier`)
	rePriority  = regexp.MustCompile(`(?i)priority|severity|urgency`)
	reMoney     = regexp.MustCompile(`(?i)price|amount|cost|total|balance|discount|fee|salary|revenue|budget`)
	reCount     = regexp.MustCompile(`(?i)count|quantity|qty|age|year|sequence|order_num|items_count`)
	reParagraph = regexp.MustCompile(`(?i)description|content|body|notes|comment|summary|bio|details|message`)
	reJSON      = regexp.MustCompile(`(?i)meta|metadata|payload|config|settings|options|attributes|json`)
)

// InferGenerator intelligently inspects column name and type to pick the best generator config.
func InferGenerator(col types.ColumnMeta) GeneratorConfig {
	colName := strings.ToLower(col.Name)
	dataType := strings.ToLower(col.DataType)
	if dataType == "" {
		dataType = strings.ToLower(col.Type)
	}

	// 1. Primary Keys
	if col.IsPrimary {
		if strings.Contains(dataType, "int") || strings.Contains(dataType, "serial") {
			return GeneratorConfig{Type: GenSequence}
		}
		if reUUID.MatchString(colName) || strings.Contains(dataType, "uuid") || strings.Contains(dataType, "char(36)") {
			return GeneratorConfig{Type: GenUUID}
		}
		return GeneratorConfig{Type: GenSequence}
	}

	// 2. Foreign Keys
	if col.IsForeignKey {
		return GeneratorConfig{Type: GenFK}
	}

	// 3. Name-based heuristics
	if reEmail.MatchString(colName) {
		return GeneratorConfig{Type: GenEmail}
	}
	if reFirstName.MatchString(colName) {
		return GeneratorConfig{Type: GenFirstName}
	}
	if reLastName.MatchString(colName) {
		return GeneratorConfig{Type: GenLastName}
	}
	if reName.MatchString(colName) {
		return GeneratorConfig{Type: GenName}
	}
	if rePhone.MatchString(colName) {
		return GeneratorConfig{Type: GenPhone}
	}
	if reAddress.MatchString(colName) {
		return GeneratorConfig{Type: GenAddress}
	}
	if reCity.MatchString(colName) {
		return GeneratorConfig{Type: GenCity}
	}
	if reCountry.MatchString(colName) {
		return GeneratorConfig{Type: GenCountry}
	}
	if rePostal.MatchString(colName) {
		return GeneratorConfig{Type: GenPostalCode}
	}
	if reUUID.MatchString(colName) {
		return GeneratorConfig{Type: GenUUID}
	}
	if reTimestamp.MatchString(colName) {
		return GeneratorConfig{Type: GenTimestamp}
	}
	if reDate.MatchString(colName) {
		return GeneratorConfig{Type: GenDate}
	}
	if reBoolean.MatchString(colName) {
		return GeneratorConfig{Type: GenBoolean, TruePct: 75}
	}
	if reStatus.MatchString(colName) {
		return GeneratorConfig{Type: GenEnum, Options: statusEnums}
	}
	if reRole.MatchString(colName) {
		return GeneratorConfig{Type: GenEnum, Options: roleEnums}
	}
	if rePriority.MatchString(colName) {
		return GeneratorConfig{Type: GenEnum, Options: priorityEnums}
	}
	if reMoney.MatchString(colName) {
		return GeneratorConfig{Type: GenDecimal, Min: 10, Max: 500, Decimals: 2}
	}
	if reCount.MatchString(colName) {
		return GeneratorConfig{Type: GenInteger, Min: 1, Max: 100}
	}
	if reParagraph.MatchString(colName) {
		return GeneratorConfig{Type: GenParagraph}
	}
	if reJSON.MatchString(colName) {
		return GeneratorConfig{Type: GenJSON}
	}

	// 4. Data type fallbacks
	if strings.Contains(dataType, "bool") {
		return GeneratorConfig{Type: GenBoolean, TruePct: 50}
	}
	if strings.Contains(dataType, "uuid") {
		return GeneratorConfig{Type: GenUUID}
	}
	if strings.Contains(dataType, "timestamp") || strings.Contains(dataType, "datetime") {
		return GeneratorConfig{Type: GenTimestamp}
	}
	if strings.Contains(dataType, "date") {
		return GeneratorConfig{Type: GenDate}
	}
	if strings.Contains(dataType, "json") {
		return GeneratorConfig{Type: GenJSON}
	}
	if strings.Contains(dataType, "decimal") || strings.Contains(dataType, "numeric") ||
		strings.Contains(dataType, "float") || strings.Contains(dataType, "double") ||
		strings.Contains(dataType, "real") {
		return GeneratorConfig{Type: GenDecimal, Min: 10, Max: 1000, Decimals: 2}
	}
	if strings.Contains(dataType, "int") || strings.Contains(dataType, "serial") {
		return GeneratorConfig{Type: GenInteger, Min: 1, Max: 10000}
	}

	// Default to text
	return GeneratorConfig{Type: GenText}
}
