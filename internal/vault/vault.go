package vault

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
)

const (
	CurrentVaultVersion = 1
	KDFArgon2id         = "argon2id"
	DefaultVaultFile    = "team-vault.dblens-vault.enc"
)

// KDFParams holds Argon2id key derivation parameters.
type KDFParams struct {
	SaltHex     string `json:"salt"`
	MemoryKB    uint32 `json:"memory_kb"`
	Iterations  uint32 `json:"iterations"`
	Parallelism uint8  `json:"parallelism"`
	KeyLen      uint32 `json:"key_len"`
}

// VaultContainer represents the encrypted portable envelope.
type VaultContainer struct {
	Version    int       `json:"version"`
	KDF        string    `json:"kdf"`
	Params     KDFParams `json:"params"`
	Nonce      string    `json:"nonce"`
	Ciphertext string    `json:"ciphertext"`
	HMAC       string    `json:"hmac"`
	CreatedAt  string    `json:"created_at,omitempty"`
}

// ConnectionPolicy defines individual connection security constraints.
type ConnectionPolicy struct {
	EnforceReadOnly bool     `json:"enforce_read_only"`
	RequireAuditLog bool     `json:"require_audit_log"`
	AllowedRoles    []string `json:"allowed_roles,omitempty"`
}

// VaultConnection represents a serialized connection profile in the vault.
type VaultConnection struct {
	ID          string           `json:"id"`
	Name        string           `json:"name"`
	Driver      string           `json:"driver"`
	DSN         string           `json:"dsn"`
	Environment string           `json:"environment,omitempty"`
	ReadOnly    bool             `json:"read_only"`
	Policy      ConnectionPolicy `json:"policy"`
}

// VaultPolicy defines global guardrails across the vault.
type VaultPolicy struct {
	GlobalReadOnlyProd  bool     `json:"global_read_only_prod"`
	RequireAuditAllProd bool     `json:"require_audit_all_prod"`
	AllowedEnvironments []string `json:"allowed_environments,omitempty"`
}

// VaultPayload is the decrypted data payload.
type VaultPayload struct {
	Version     int               `json:"version"`
	Name        string            `json:"name,omitempty"`
	Description string            `json:"description,omitempty"`
	ExportedAt  string            `json:"exported_at"`
	ExportedBy  string            `json:"exported_by,omitempty"`
	Connections []VaultConnection `json:"connections"`
	Policies    VaultPolicy       `json:"policies"`
}

// ExportRequest is sent to encrypt and serialize connections.
type ExportRequest struct {
	Passphrase     string            `json:"passphrase"`
	Name           string            `json:"name,omitempty"`
	Description    string            `json:"description,omitempty"`
	ExportedBy     string            `json:"exported_by,omitempty"`
	Connections    []VaultConnection `json:"connections"`
	Policies       VaultPolicy       `json:"policies"`
	ScrubPasswords bool              `json:"scrub_passwords"`
}

// ExportResponse returns the encrypted envelope and raw JSON.
type ExportResponse struct {
	Container VaultContainer `json:"container"`
	RawJSON   string         `json:"raw_json"`
	Filename  string         `json:"filename"`
}

// ImportRequest is sent to inspect and decrypt a vault envelope.
type ImportRequest struct {
	Container      *VaultContainer `json:"container,omitempty"`
	RawContainer   string          `json:"raw_container,omitempty"`
	Passphrase     string          `json:"passphrase"`
	ApplyPolicies  bool            `json:"apply_policies"`
	InterpolateEnv bool            `json:"interpolate_env"`
}

// ImportResponse returns the decrypted preview and guardrail actions.
type ImportResponse struct {
	Valid            bool              `json:"valid"`
	Payload          *VaultPayload     `json:"payload,omitempty"`
	Connections      []VaultConnection `json:"connections"`
	Policies         VaultPolicy       `json:"policies"`
	SubstitutedVars  []string          `json:"substituted_vars"`
	EnforcedPolicies []string          `json:"enforced_policies"`
}

// UnlockRequest unlocks the vault in memory for the current session.
type UnlockRequest struct {
	Passphrase   string          `json:"passphrase"`
	Container    *VaultContainer `json:"container,omitempty"`
	RawContainer string          `json:"raw_container,omitempty"`
}

// UnlockResponse returns unlocked state details.
type UnlockResponse struct {
	Unlocked         bool              `json:"unlocked"`
	ConnectionsCount int               `json:"connections_count"`
	Connections      []VaultConnection `json:"connections"`
	Policies         VaultPolicy       `json:"policies"`
	UnlockedAt       string            `json:"unlocked_at"`
}

// LockResponse confirms vault lock.
type LockResponse struct {
	Locked bool `json:"locked"`
}

// VaultStatusResponse describes the active vault state.
type VaultStatusResponse struct {
	IsUnlocked       bool        `json:"is_unlocked"`
	HasContainer     bool        `json:"has_container"`
	ConnectionsCount int         `json:"connections_count"`
	ActivePolicies   VaultPolicy `json:"active_policies"`
	UnlockedAt       string      `json:"unlocked_at,omitempty"`
}

// Manager coordinates vault crypto, memory state, and policy enforcement.
type Manager struct {
	mu             sync.RWMutex
	isUnlocked     bool
	unlockedAt     time.Time
	container      *VaultContainer
	connections    []VaultConnection
	activePolicies VaultPolicy
	fastKDF        bool
}

// NewManager initializes an empty Manager.
func NewManager() *Manager {
	return &Manager{}
}

// SetFastKDF enables lightweight parameters for fast unit tests.
func (m *Manager) SetFastKDF(fast bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.fastKDF = fast
}

// Export encrypts and packages connections into a VaultContainer.
func (m *Manager) Export(req ExportRequest) (*ExportResponse, error) {
	if strings.TrimSpace(req.Passphrase) == "" {
		return nil, errors.New("passphrase cannot be empty")
	}

	conns := make([]VaultConnection, len(req.Connections))
	copy(conns, req.Connections)

	if req.ScrubPasswords {
		conns = ScrubPasswords(conns)
	}

	payload := VaultPayload{
		Version:     CurrentVaultVersion,
		Name:        req.Name,
		Description: req.Description,
		ExportedAt:  time.Now().UTC().Format(time.RFC3339),
		ExportedBy:  req.ExportedBy,
		Connections: conns,
		Policies:    req.Policies,
	}

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to encode vault payload: %w", err)
	}
	defer zeroBytes(payloadBytes)

	m.mu.RLock()
	useFast := m.fastKDF
	m.mu.RUnlock()

	params := DefaultKDFParams()
	if useFast {
		params = FastKDFParams()
	}

	container, err := EncryptPayload(payloadBytes, req.Passphrase, params)
	if err != nil {
		return nil, fmt.Errorf("encryption failed: %w", err)
	}

	rawJSON, err := json.MarshalIndent(container, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("failed to serialize container: %w", err)
	}

	filename := DefaultVaultFile
	if req.Name != "" {
		slug := strings.ToLower(strings.ReplaceAll(req.Name, " ", "-"))
		filename = fmt.Sprintf("%s.dblens-vault.enc", slug)
	}

	return &ExportResponse{
		Container: *container,
		RawJSON:   string(rawJSON),
		Filename:  filename,
	}, nil
}

// ResolveContainer extracts a VaultContainer from structured request or raw JSON string.
func ResolveContainer(c *VaultContainer, raw string) (*VaultContainer, error) {
	if c != nil && c.Ciphertext != "" {
		return c, nil
	}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, errors.New("no vault container provided")
	}
	var parsed VaultContainer
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return nil, fmt.Errorf("invalid container JSON: %w", err)
	}
	if parsed.Ciphertext == "" {
		return nil, errors.New("missing ciphertext in vault container")
	}
	return &parsed, nil
}

// Import decrypts a container, interpolates secrets if requested, and enforces policies.
func (m *Manager) Import(req ImportRequest) (*ImportResponse, error) {
	container, err := ResolveContainer(req.Container, req.RawContainer)
	if err != nil {
		return nil, err
	}

	if strings.TrimSpace(req.Passphrase) == "" {
		return nil, errors.New("passphrase cannot be empty")
	}

	payloadBytes, err := DecryptPayload(container, req.Passphrase)
	if err != nil {
		return nil, err
	}
	defer zeroBytes(payloadBytes)

	var payload VaultPayload
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		return nil, fmt.Errorf("failed to decode decrypted payload: %w", err)
	}

	conns := payload.Connections
	var substitutedVars []string

	if req.InterpolateEnv {
		var newConns []VaultConnection
		for _, c := range conns {
			interpConn, vars := InterpolateConnection(c)
			newConns = append(newConns, interpConn)
			substitutedVars = append(substitutedVars, vars...)
		}
		conns = newConns
	}

	conns, enforcedLogs := EnforcePolicies(conns, payload.Policies)

	return &ImportResponse{
		Valid:            true,
		Payload:          &payload,
		Connections:      conns,
		Policies:         payload.Policies,
		SubstitutedVars:  substitutedVars,
		EnforcedPolicies: enforcedLogs,
	}, nil
}

// Unlock decrypts and stores the vault container in memory for session use.
func (m *Manager) Unlock(req UnlockRequest) (*UnlockResponse, error) {
	var container *VaultContainer
	var err error

	if req.Container != nil || strings.TrimSpace(req.RawContainer) != "" {
		container, err = ResolveContainer(req.Container, req.RawContainer)
		if err != nil {
			return nil, err
		}
	} else {
		m.mu.RLock()
		container = m.container
		m.mu.RUnlock()
	}

	if container == nil {
		return nil, errors.New("no vault container loaded or provided to unlock")
	}

	if strings.TrimSpace(req.Passphrase) == "" {
		return nil, errors.New("passphrase cannot be empty")
	}

	payloadBytes, err := DecryptPayload(container, req.Passphrase)
	if err != nil {
		return nil, err
	}
	defer zeroBytes(payloadBytes)

	var payload VaultPayload
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		return nil, fmt.Errorf("failed to parse decrypted vault: %w", err)
	}

	conns, _ := EnforcePolicies(payload.Connections, payload.Policies)

	now := time.Now().UTC()
	m.mu.Lock()
	m.container = container
	m.connections = conns
	m.activePolicies = payload.Policies
	m.isUnlocked = true
	m.unlockedAt = now
	m.mu.Unlock()

	return &UnlockResponse{
		Unlocked:         true,
		ConnectionsCount: len(conns),
		Connections:      conns,
		Policies:         payload.Policies,
		UnlockedAt:       now.Format(time.RFC3339),
	}, nil
}

// Lock clears decrypted credentials and resets unlocked state.
func (m *Manager) Lock() *LockResponse {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.isUnlocked = false
	m.connections = nil
	m.activePolicies = VaultPolicy{}
	m.unlockedAt = time.Time{}

	return &LockResponse{Locked: true}
}

// Status returns the active vault status.
func (m *Manager) Status() *VaultStatusResponse {
	m.mu.RLock()
	defer m.mu.RUnlock()

	unlockedStr := ""
	if !m.unlockedAt.IsZero() {
		unlockedStr = m.unlockedAt.Format(time.RFC3339)
	}

	return &VaultStatusResponse{
		IsUnlocked:       m.isUnlocked,
		HasContainer:     m.container != nil,
		ConnectionsCount: len(m.connections),
		ActivePolicies:   m.activePolicies,
		UnlockedAt:       unlockedStr,
	}
}
