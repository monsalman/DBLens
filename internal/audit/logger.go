package audit

import (
	"bufio"
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
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

	stateMu   sync.RWMutex // guards closed + the send in Log against close(ch)
	closed    bool
	closeOnce sync.Once
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
	// Resume the hash chain from the last persisted entry. Without this a
	// restart restarts the chain mid-file, so every subsequent entry looks
	// tampered to VerifyChain.
	l.lastHash = lastHashFromFile(path)
	go l.run()
	return l, nil
}

// lastHashFromFile reads the final complete line of an append-only NDJSON log
// and returns its hash. Returns "" for an empty/unreadable file.
func lastHashFromFile(path string) string {
	f, err := os.Open(path) // separate read handle: the writer is O_WRONLY
	if err != nil {
		return ""
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || info.Size() == 0 {
		return ""
	}
	const maxLine = 1 << 20 // audit entries are far smaller than 1 MiB
	size := info.Size()
	start := size - maxLine
	if start < 0 {
		start = 0
	}
	buf := make([]byte, size-start)
	n, err := f.ReadAt(buf, start)
	if n <= 0 {
		return ""
	}
	if err != nil && err != io.EOF {
		return ""
	}
	buf = buf[:n]
	buf = bytes.TrimRight(buf, "\n")
	if idx := bytes.LastIndexByte(buf, '\n'); idx >= 0 {
		buf = buf[idx+1:]
	}
	var e AuditEntry
	if err := json.Unmarshal(buf, &e); err != nil {
		return ""
	}
	return e.Hash
}

// Log enqueues entry; drops silently if the channel is full (never blocks the
// request path). It is a safe no-op after Close, so a late audit entry can
// never send on a closed channel.
func (l *AuditLogger) Log(e AuditEntry) {
	if l == nil {
		return
	}
	l.stateMu.RLock()
	defer l.stateMu.RUnlock()
	if l.closed {
		return
	}
	select {
	case l.ch <- e:
	default:
	}
}

// Close flushes and closes the log. It is idempotent and safe to call twice.
func (l *AuditLogger) Close() {
	if l == nil {
		return
	}
	l.closeOnce.Do(func() {
		l.stateMu.Lock()
		l.closed = true
		close(l.ch)
		l.stateMu.Unlock()
		<-l.done
	})
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
			prevHash = ""
			continue
		}
		// Verify both (a) this line's own HMAC and (b) that it links to the
		// previous line's hash. A break is reported at the junction only:
		// prevHash is then resynced from the stored hash so a single broken
		// entry cannot cascade false positives onto every later line.
		stored := e.Hash
		linksToPrev := e.PrevHash == prevHash
		e.Hash = ""
		e.PrevHash = prevHash
		expected := computeHMAC(e)
		if stored != expected || !linksToPrev {
			corrupted = append(corrupted, lineNum)
		}
		prevHash = stored
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
