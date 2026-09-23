package analyzer

import (
	"strings"
	"unicode"
)

type TokenType int

const (
	TokenEOF TokenType = iota
	TokenKeyword
	TokenIdent
	TokenString
	TokenNumber
	TokenComment
	TokenOperator
	TokenPunctuation
)

func (t TokenType) String() string {
	switch t {
	case TokenKeyword:
		return "KEYWORD"
	case TokenIdent:
		return "IDENT"
	case TokenString:
		return "STRING"
	case TokenNumber:
		return "NUMBER"
	case TokenComment:
		return "COMMENT"
	case TokenOperator:
		return "OPERATOR"
	case TokenPunctuation:
		return "PUNCTUATION"
	default:
		return "EOF"
	}
}

type Token struct {
	Type        TokenType `json:"type"`
	Value       string    `json:"value"`
	Raw         string    `json:"raw"`
	Line        int       `json:"line"`
	Col         int       `json:"col"`
	StartOffset int       `json:"start_offset"`
	EndOffset   int       `json:"end_offset"`
}

func (t Token) IsKeyword(kw string) bool {
	return t.Type == TokenKeyword && strings.EqualFold(t.Value, kw)
}

func (t Token) IsOperator(op string) bool {
	return t.Type == TokenOperator && t.Value == op
}

func (t Token) IsPunctuation(p string) bool {
	return t.Type == TokenPunctuation && t.Value == p
}

var sqlKeywords = map[string]bool{
	"SELECT": true, "FROM": true, "WHERE": true, "JOIN": true, "INNER": true,
	"LEFT": true, "RIGHT": true, "FULL": true, "OUTER": true, "CROSS": true,
	"NATURAL": true, "ON": true, "USING": true, "ORDER": true, "BY": true,
	"GROUP": true, "HAVING": true, "LIMIT": true, "OFFSET": true, "FETCH": true,
	"FIRST": true, "NEXT": true, "ROWS": true, "ROW": true, "ONLY": true,
	"WITH": true, "RECURSIVE": true, "AS": true, "UPDATE": true, "DELETE": true,
	"SET": true, "INSERT": true, "INTO": true, "VALUES": true, "UNION": true,
	"ALL": true, "EXISTS": true, "IN": true, "NOT": true, "LIKE": true,
	"ILIKE": true, "BETWEEN": true, "IS": true, "NULL": true, "AND": true,
	"OR": true, "CASE": true, "WHEN": true, "THEN": true, "ELSE": true,
	"END": true, "DISTINCT": true, "TRUE": true, "FALSE": true, "CREATE": true,
	"DROP": true, "ALTER": true, "TABLE": true, "VIEW": true, "INDEX": true,
	"TRIGGER": true, "PROCEDURE": true, "FUNCTION": true, "DATABASE": true,
	"SCHEMA": true, "TRUNCATE": true, "DESC": true, "ASC": true, "COUNT": true,
	"SUM": true, "AVG": true, "MIN": true, "MAX": true, "COALESCE": true,
	"CAST": true, "EXPLAIN": true, "ANALYZE": true, "WINDOW": true, "OVER": true,
	"PARTITION": true, "INTERSECT": true, "EXCEPT": true, "COLLATE": true,
	"SIMILAR": true, "TO": true, "REPLACE": true, "DEFAULT": true, "CHECK": true,
	"PRIMARY": true, "KEY": true, "FOREIGN": true, "REFERENCES": true,
	"UNIQUE": true, "CASCADE": true, "RESTRICT": true,
}

type Tokenizer struct {
	src    string
	length int
	offset int
	line   int
	col    int
}

func NewTokenizer(src string) *Tokenizer {
	return &Tokenizer{
		src:    src,
		length: len(src),
		offset: 0,
		line:   1,
		col:    1,
	}
}

func Tokenize(sql string) []Token {
	t := NewTokenizer(sql)
	var tokens []Token
	for {
		tok := t.NextToken()
		if tok.Type == TokenEOF {
			break
		}
		tokens = append(tokens, tok)
	}
	return tokens
}

func TokensWithoutComments(tokens []Token) []Token {
	res := make([]Token, 0, len(tokens))
	for _, tok := range tokens {
		if tok.Type != TokenComment {
			res = append(res, tok)
		}
	}
	return res
}

func (t *Tokenizer) peek() byte {
	if t.offset >= t.length {
		return 0
	}
	return t.src[t.offset]
}

func (t *Tokenizer) peekNext() byte {
	if t.offset+1 >= t.length {
		return 0
	}
	return t.src[t.offset+1]
}

func (t *Tokenizer) advance() byte {
	if t.offset >= t.length {
		return 0
	}
	ch := t.src[t.offset]
	t.offset++
	if ch == '\n' {
		t.line++
		t.col = 1
	} else {
		t.col++
	}
	return ch
}

func (t *Tokenizer) skipWhitespace() {
	for t.offset < t.length {
		ch := t.src[t.offset]
		if unicode.IsSpace(rune(ch)) {
			t.advance()
		} else {
			break
		}
	}
}

func (t *Tokenizer) NextToken() Token {
	t.skipWhitespace()

	if t.offset >= t.length {
		return Token{
			Type:        TokenEOF,
			Line:        t.line,
			Col:         t.col,
			StartOffset: t.offset,
			EndOffset:   t.offset,
		}
	}

	startOffset := t.offset
	startLine := t.line
	startCol := t.col
	ch := t.peek()

	// 1. Line comment: -- or #
	if (ch == '-' && t.peekNext() == '-') || ch == '#' {
		t.advance() // '-' or '#'
		if ch == '-' {
			t.advance() // '-'
		}
		for t.offset < t.length && t.peek() != '\n' {
			t.advance()
		}
		raw := t.src[startOffset:t.offset]
		return Token{
			Type:        TokenComment,
			Value:       strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(raw, "--"), "#")),
			Raw:         raw,
			Line:        startLine,
			Col:         startCol,
			StartOffset: startOffset,
			EndOffset:   t.offset,
		}
	}

	// 2. Block comment: /* ... */
	if ch == '/' && t.peekNext() == '*' {
		t.advance() // '/'
		t.advance() // '*'
		for t.offset < t.length {
			if t.peek() == '*' && t.peekNext() == '/' {
				t.advance() // '*'
				t.advance() // '/'
				break
			}
			t.advance()
		}
		raw := t.src[startOffset:t.offset]
		val := raw
		if strings.HasPrefix(val, "/*") && strings.HasSuffix(val, "*/") {
			val = strings.TrimSpace(val[2 : len(val)-2])
		}
		return Token{
			Type:        TokenComment,
			Value:       val,
			Raw:         raw,
			Line:        startLine,
			Col:         startCol,
			StartOffset: startOffset,
			EndOffset:   t.offset,
		}
	}

	// 3. PostgreSQL dollar quotes: $$...$$ or $tag$...$tag$
	if ch == '$' && t.looksLikeDollarQuote() {
		tag := t.readDollarTag()
		for t.offset < t.length {
			if t.peek() == '$' && strings.HasPrefix(t.src[t.offset:], tag) {
				for range tag {
					t.advance()
				}
				break
			}
			t.advance()
		}
		raw := t.src[startOffset:t.offset]
		val := raw
		if strings.HasPrefix(val, tag) && strings.HasSuffix(val, tag) && len(val) >= len(tag)*2 {
			val = val[len(tag) : len(val)-len(tag)]
		}
		return Token{
			Type:        TokenString,
			Value:       val,
			Raw:         raw,
			Line:        startLine,
			Col:         startCol,
			StartOffset: startOffset,
			EndOffset:   t.offset,
		}
	}

	// 4. String literal: '...' or (Postgres) E'...' / b'...'
	if ch == '\'' || ((ch == 'E' || ch == 'e' || ch == 'B' || ch == 'b' || ch == 'X' || ch == 'x') && t.peekNext() == '\'') {
		if ch != '\'' {
			t.advance() // 'E' or prefix
		}
		t.advance() // opening quote
		var val strings.Builder
		for t.offset < t.length {
			c := t.peek()
			if c == '\'' {
				t.advance()
				if t.peek() == '\'' { // escaped ''
					val.WriteByte('\'')
					t.advance()
				} else {
					break
				}
			} else if c == '\\' && t.peekNext() == '\'' { // \'
				t.advance() // backslash
				val.WriteByte('\'')
				t.advance() // quote
			} else {
				val.WriteByte(c)
				t.advance()
			}
		}
		raw := t.src[startOffset:t.offset]
		return Token{
			Type:        TokenString,
			Value:       val.String(),
			Raw:         raw,
			Line:        startLine,
			Col:         startCol,
			StartOffset: startOffset,
			EndOffset:   t.offset,
		}
	}

	// 5. Quoted Identifiers: "..." or `...` or [...]
	if ch == '"' || ch == '`' || ch == '[' {
		closing := byte('"')
		if ch == '`' {
			closing = '`'
		} else if ch == '[' {
			closing = ']'
		}
		t.advance() // open quote
		var val strings.Builder
		for t.offset < t.length {
			c := t.peek()
			if c == closing {
				t.advance()
				if closing != ']' && t.peek() == closing { // double quote escape
					val.WriteByte(closing)
					t.advance()
				} else {
					break
				}
			} else {
				val.WriteByte(c)
				t.advance()
			}
		}
		raw := t.src[startOffset:t.offset]
		return Token{
			Type:        TokenIdent,
			Value:       val.String(),
			Raw:         raw,
			Line:        startLine,
			Col:         startCol,
			StartOffset: startOffset,
			EndOffset:   t.offset,
		}
	}

	// 6. Numbers: digits or . followed by digits
	if unicode.IsDigit(rune(ch)) || (ch == '.' && unicode.IsDigit(rune(t.peekNext()))) {
		isHex := false
		if ch == '0' && (t.peekNext() == 'x' || t.peekNext() == 'X') {
			isHex = true
			t.advance()
			t.advance()
			for t.offset < t.length && isHexDigit(t.peek()) {
				t.advance()
			}
		} else {
			for t.offset < t.length && unicode.IsDigit(rune(t.peek())) {
				t.advance()
			}
			if t.peek() == '.' && unicode.IsDigit(rune(t.peekNext())) {
				t.advance() // '.'
				for t.offset < t.length && unicode.IsDigit(rune(t.peek())) {
					t.advance()
				}
			}
			if t.peek() == 'e' || t.peek() == 'E' {
				t.advance()
				if t.peek() == '+' || t.peek() == '-' {
					t.advance()
				}
				for t.offset < t.length && unicode.IsDigit(rune(t.peek())) {
					t.advance()
				}
			}
		}
		_ = isHex
		raw := t.src[startOffset:t.offset]
		return Token{
			Type:        TokenNumber,
			Value:       raw,
			Raw:         raw,
			Line:        startLine,
			Col:         startCol,
			StartOffset: startOffset,
			EndOffset:   t.offset,
		}
	}

	// 7. Multi-character operators and punctuation
	if ch == ':' && t.peekNext() == ':' { // :: typecast
		t.advance()
		t.advance()
		return Token{
			Type:        TokenOperator,
			Value:       "::",
			Raw:         "::",
			Line:        startLine,
			Col:         startCol,
			StartOffset: startOffset,
			EndOffset:   t.offset,
		}
	}
	if ch == '!' && t.peekNext() == '=' { // !=
		t.advance()
		t.advance()
		return Token{
			Type:        TokenOperator,
			Value:       "!=",
			Raw:         "!=",
			Line:        startLine,
			Col:         startCol,
			StartOffset: startOffset,
			EndOffset:   t.offset,
		}
	}
	if ch == '<' && t.peekNext() == '>' { // <>
		t.advance()
		t.advance()
		return Token{
			Type:        TokenOperator,
			Value:       "<>",
			Raw:         "<>",
			Line:        startLine,
			Col:         startCol,
			StartOffset: startOffset,
			EndOffset:   t.offset,
		}
	}
	if ch == '<' && t.peekNext() == '=' { // <=
		t.advance()
		t.advance()
		return Token{
			Type:        TokenOperator,
			Value:       "<=",
			Raw:         "<=",
			Line:        startLine,
			Col:         startCol,
			StartOffset: startOffset,
			EndOffset:   t.offset,
		}
	}
	if ch == '>' && t.peekNext() == '=' { // >=
		t.advance()
		t.advance()
		return Token{
			Type:        TokenOperator,
			Value:       ">=",
			Raw:         ">=",
			Line:        startLine,
			Col:         startCol,
			StartOffset: startOffset,
			EndOffset:   t.offset,
		}
	}
	if ch == '|' && t.peekNext() == '|' { // || concat
		t.advance()
		t.advance()
		return Token{
			Type:        TokenOperator,
			Value:       "||",
			Raw:         "||",
			Line:        startLine,
			Col:         startCol,
			StartOffset: startOffset,
			EndOffset:   t.offset,
		}
	}

	// 8. Single-character punctuation
	if ch == '(' || ch == ')' || ch == ',' || ch == ';' || ch == '.' || ch == '[' || ch == ']' {
		t.advance()
		return Token{
			Type:        TokenPunctuation,
			Value:       string(ch),
			Raw:         string(ch),
			Line:        startLine,
			Col:         startCol,
			StartOffset: startOffset,
			EndOffset:   t.offset,
		}
	}

	// 9. Single-character operators
	if ch == '=' || ch == '<' || ch == '>' || ch == '+' || ch == '-' || ch == '*' || ch == '/' || ch == '%' || ch == '~' || ch == '&' || ch == '|' || ch == '^' {
		t.advance()
		return Token{
			Type:        TokenOperator,
			Value:       string(ch),
			Raw:         string(ch),
			Line:        startLine,
			Col:         startCol,
			StartOffset: startOffset,
			EndOffset:   t.offset,
		}
	}

	// 10. Identifiers and Keywords
	if isIdentStart(ch) {
		for t.offset < t.length && isIdentPart(t.peek()) {
			t.advance()
		}
		raw := t.src[startOffset:t.offset]
		upper := strings.ToUpper(raw)
		if sqlKeywords[upper] {
			return Token{
				Type:        TokenKeyword,
				Value:       upper,
				Raw:         raw,
				Line:        startLine,
				Col:         startCol,
				StartOffset: startOffset,
				EndOffset:   t.offset,
			}
		}
		return Token{
			Type:        TokenIdent,
			Value:       raw,
			Raw:         raw,
			Line:        startLine,
			Col:         startCol,
			StartOffset: startOffset,
			EndOffset:   t.offset,
		}
	}

	// Fallback for unexpected characters
	t.advance()
	raw := t.src[startOffset:t.offset]
	return Token{
		Type:        TokenPunctuation,
		Value:       raw,
		Raw:         raw,
		Line:        startLine,
		Col:         startCol,
		StartOffset: startOffset,
		EndOffset:   t.offset,
	}
}

func (t *Tokenizer) looksLikeDollarQuote() bool {
	// $$ or $tag$
	if t.offset >= t.length || t.src[t.offset] != '$' {
		return false
	}
	i := t.offset + 1
	for i < t.length && isIdentPart(t.src[i]) {
		i++
	}
	return i < t.length && t.src[i] == '$'
}

func (t *Tokenizer) readDollarTag() string {
	start := t.offset
	t.advance() // first '$'
	for t.offset < t.length && isIdentPart(t.peek()) {
		t.advance()
	}
	if t.offset < t.length && t.peek() == '$' {
		t.advance() // closing '$'
	}
	return t.src[start:t.offset]
}

func isIdentStart(ch byte) bool {
	return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch == '_'
}

func isIdentPart(ch byte) bool {
	return isIdentStart(ch) || (ch >= '0' && ch <= '9') || ch == '$'
}

func isHexDigit(ch byte) bool {
	return (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F')
}
