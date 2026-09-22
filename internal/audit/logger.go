package audit

import (
	"bufio"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"time"
)

const hmacKey = "dblens-audit"

// AuditLogger writes NDJSON audit entries via a buffered channel.
type AuditLogger struct {
	ch       chan AuditEntry
	done     chan struct{}
	path     string
	mu       sync.Mutex // guards file + lastHash + currentDate
	file     *os.File
	lastHash string
	currDate string
}

// NewAuditLogger opens (or creates) path and starts the background writer.
func NewAuditLogger(path string) (*AuditLogger, error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return nil, err
	}
	l := &AuditLogger{
		ch:       make(chan AuditEntry, 512),
		done:     make(chan struct{}),
		path:     path,
		file:     f,
		currDate: time.Now().UTC().Format("2006-01-02"),
	}
	go l.run()
	return l, nil
}

// Log enqueues entry; drops silently if channel is full (never blocks request path).
func (l *AuditLogger) Log(e AuditEntry) {
	select {
	case l.ch <- e:
	default:
	}
}

// Close flushes and closes the log.
func (l *AuditLogger) Close() {
	close(l.ch)
	<-l.done
}

func (l *AuditLogger) run() {
	defer close(l.done)
	for e := range l.ch {
		l.write(e)
	}
	l.mu.Lock()
	if l.file != nil {
		_ = l.file.Close()
	}
	l.mu.Unlock()
}

func (l *AuditLogger) write(e AuditEntry) {
	l.mu.Lock()
	defer l.mu.Unlock()

	// Daily rotation check
	today := time.Now().UTC().Format("2006-01-02")
	if today != l.currDate {
		_ = l.rotate(today)
	}

	// Set chain hash
	e.PrevHash = l.lastHash
	e.Hash = computeHMAC(e)

	data, err := json.Marshal(e)
	if err != nil {
		return
	}
	data = append(data, '\n')
	_, _ = l.file.Write(data)
	l.lastHash = e.Hash
}

// rotate renames current file to audit-YYYY-MM-DD.log, opens new file, prunes old.
func (l *AuditLogger) rotate(today string) error {
	dir := dirOf(l.path)
	oldName := fmt.Sprintf("%s/audit-%s.log", dir, l.currDate)
	_ = l.file.Close()
	_ = os.Rename(l.path, oldName)

	f, err := os.OpenFile(l.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	l.file = f
	l.currDate = today
	l.lastHash = "" // reset chain for new file
	pruneOldRotated(dir, 30)
	return nil
}

// VerifyChain reads path, re-computes each hash, returns ok + corrupted line numbers.
func VerifyChain(path string) (bool, []int, error) {
	f, err := os.Open(path)
	if err != nil {
		return false, nil, err
	}
	defer f.Close()

	var (
		scanner   = bufio.NewScanner(f)
		prevHash  = ""
		lineNum   = 0
		corrupted []int
	)
	for scanner.Scan() {
		lineNum++
		line := scanner.Bytes()
		var e AuditEntry
		if err := json.Unmarshal(line, &e); err != nil {
			corrupted = append(corrupted, lineNum)
			continue
		}
		// re-compute: save stored hash, clear it, set prevHash, compute
		stored := e.Hash
		e.Hash = ""
		e.PrevHash = prevHash
		expected := computeHMAC(e)
		if stored != expected {
			corrupted = append(corrupted, lineNum)
		} else {
			prevHash = stored
		}
	}
	if err := scanner.Err(); err != nil {
		return false, corrupted, err
	}
	return len(corrupted) == 0, corrupted, nil
}

// computeHMAC computes HMAC-SHA256 over JSON of e (with e.Hash="").
func computeHMAC(e AuditEntry) string {
	e.Hash = ""
	data, _ := json.Marshal(e)
	mac := hmac.New(sha256.New, []byte(hmacKey))
	mac.Write(data)
	return hex.EncodeToString(mac.Sum(nil))
}

func dirOf(path string) string {
	for i := len(path) - 1; i >= 0; i-- {
		if path[i] == '/' {
			return path[:i]
		}
	}
	return "."
}
