package tunnel

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
)

var (
	reMySQLTCP = regexp.MustCompile(`@?tcp\(([^:]+):(\d+)\)`)

	_, tunnelLinkLocalV4, _ = net.ParseCIDR("169.254.0.0/16")
	_, tunnelLinkLocalV6, _ = net.ParseCIDR("fe80::/10")
)

// ValidateTunnelHost validates that the bastion host is not a prohibited cloud metadata or link-local address.
func ValidateTunnelHost(host string) error {
	host = strings.TrimSpace(host)
	if host == "" {
		return errors.New("bastion host is required")
	}

	hostLower := strings.ToLower(host)
	if hostLower == "169.254.169.254" ||
		hostLower == "metadata.google.internal" ||
		hostLower == "instance-data" ||
		strings.HasSuffix(hostLower, ".metadata.google.internal") ||
		strings.HasSuffix(hostLower, ".instance-data") {
		return fmt.Errorf("bastion host blocked: cloud metadata access prohibited (%s)", host)
	}

	ip := net.ParseIP(host)
	if ip != nil {
		if ip.String() == "169.254.169.254" ||
			ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
			(tunnelLinkLocalV4 != nil && tunnelLinkLocalV4.Contains(ip)) ||
			(tunnelLinkLocalV6 != nil && tunnelLinkLocalV6.Contains(ip)) {
			return fmt.Errorf("bastion host blocked: link-local or metadata address prohibited (%s)", ip.String())
		}
	}
	return nil
}

type SSHTunnelConfig struct {
	Enabled    bool   `json:"enabled"`
	Host       string `json:"host"`
	Port       int    `json:"port"` // defaults to 22 if 0
	User       string `json:"user"`
	AuthMethod string `json:"auth_method"` // "password", "key", "agent"
	Password   string `json:"password,omitempty"`
	PrivateKey string `json:"private_key,omitempty"`
	Passphrase string `json:"passphrase,omitempty"`
}

type TunnelTestResult struct {
	Success   bool   `json:"success"`
	Message   string `json:"message"`
	LatencyMS int64  `json:"latency_ms"`
	Banner    string `json:"banner,omitempty"`
}

type ActiveForwarder struct {
	ID         string
	Listener   net.Listener
	LocalPort  int
	LocalAddr  string
	RemoteAddr string
	SSHClient  *ssh.Client

	closeOnce sync.Once
	closed    chan struct{}
	mu        sync.Mutex
	conns     map[net.Conn]struct{}
}

func (f *ActiveForwarder) Close() error {
	var err error
	f.closeOnce.Do(func() {
		close(f.closed)
		if f.Listener != nil {
			err = f.Listener.Close()
		}
		f.mu.Lock()
		for c := range f.conns {
			_ = c.Close()
		}
		f.conns = make(map[net.Conn]struct{})
		f.mu.Unlock()

		if f.SSHClient != nil {
			_ = f.SSHClient.Close()
		}
	})
	return err
}

func (f *ActiveForwarder) serve() {
	for {
		localConn, err := f.Listener.Accept()
		if err != nil {
			select {
			case <-f.closed:
				return
			default:
				return
			}
		}
		go f.forward(localConn)
	}
}

func (f *ActiveForwarder) forward(localConn net.Conn) {
	f.mu.Lock()
	select {
	case <-f.closed:
		f.mu.Unlock()
		_ = localConn.Close()
		return
	default:
	}
	f.conns[localConn] = struct{}{}
	f.mu.Unlock()

	remoteConn, err := f.SSHClient.Dial("tcp", f.RemoteAddr)
	if err != nil {
		f.mu.Lock()
		delete(f.conns, localConn)
		f.mu.Unlock()
		_ = localConn.Close()
		return
	}

	var once sync.Once
	cleanup := func() {
		_ = localConn.Close()
		_ = remoteConn.Close()
		f.mu.Lock()
		delete(f.conns, localConn)
		f.mu.Unlock()
	}

	go func() {
		_, _ = io.Copy(remoteConn, localConn)
		once.Do(cleanup)
	}()
	go func() {
		_, _ = io.Copy(localConn, remoteConn)
		once.Do(cleanup)
	}()
}

// BuildSSHClientConfig creates ssh.ClientConfig from SSHTunnelConfig.
func BuildSSHClientConfig(cfg SSHTunnelConfig) (*ssh.ClientConfig, error) {
	if strings.TrimSpace(cfg.User) == "" {
		return nil, errors.New("ssh username is required")
	}

	authMethod := strings.ToLower(strings.TrimSpace(cfg.AuthMethod))
	if authMethod == "" {
		if cfg.PrivateKey != "" {
			authMethod = "key"
		} else if cfg.Password != "" {
			authMethod = "password"
		} else {
			authMethod = "agent"
		}
	}

	var auth []ssh.AuthMethod

	switch authMethod {
	case "password":
		auth = append(auth, ssh.Password(cfg.Password))
	case "key", "private_key":
		keyBytes := []byte(strings.TrimSpace(cfg.PrivateKey))
		if len(keyBytes) == 0 {
			return nil, errors.New("private key is empty")
		}
		var signer ssh.Signer
		var err error
		if cfg.Passphrase != "" {
			signer, err = ssh.ParsePrivateKeyWithPassphrase(keyBytes, []byte(cfg.Passphrase))
		} else {
			signer, err = ssh.ParsePrivateKey(keyBytes)
		}
		if err != nil {
			return nil, fmt.Errorf("failed to parse private key: %w", err)
		}
		auth = append(auth, ssh.PublicKeys(signer))
	case "agent":
		if os.Getenv("DBLENS_ALLOW_SSH_AGENT") != "true" {
			return nil, errors.New("SSH agent authentication disabled by server policy")
		}
		sock := os.Getenv("SSH_AUTH_SOCK")
		if sock == "" {
			return nil, errors.New("SSH_AUTH_SOCK environment variable not set")
		}
		conn, err := net.Dial("unix", sock)
		if err != nil {
			return nil, fmt.Errorf("failed to connect to SSH agent at %s: %w", sock, err)
		}
		agentClient := agent.NewClient(conn)
		signers, err := agentClient.Signers()
		if err != nil {
			_ = conn.Close()
			return nil, fmt.Errorf("failed to get keys from SSH agent: %w", err)
		}
		if len(signers) == 0 {
			_ = conn.Close()
			return nil, errors.New("no identities found in SSH agent")
		}
		auth = append(auth, ssh.PublicKeys(signers...))
	default:
		return nil, fmt.Errorf("unsupported auth method: %s", authMethod)
	}

	clientConfig := &ssh.ClientConfig{
		User:            strings.TrimSpace(cfg.User),
		Auth:            auth,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         10 * time.Second,
	}

	return clientConfig, nil
}

// TestTunnel tests SSH bastion connectivity and measures round-trip handshake latency.
func TestTunnel(cfg SSHTunnelConfig) (*TunnelTestResult, error) {
	host := strings.TrimSpace(cfg.Host)
	if err := ValidateTunnelHost(host); err != nil {
		res := &TunnelTestResult{Success: false, Message: err.Error()}
		return res, err
	}
	port := cfg.Port
	if port <= 0 {
		port = 22
	}

	clientConfig, err := BuildSSHClientConfig(cfg)
	if err != nil {
		res := &TunnelTestResult{Success: false, Message: err.Error()}
		return res, err
	}

	addr := net.JoinHostPort(host, strconv.Itoa(port))
	start := time.Now()
	client, err := ssh.Dial("tcp", addr, clientConfig)
	if err != nil {
		res := &TunnelTestResult{
			Success: false,
			Message: fmt.Sprintf("SSH connection to %s failed: %v", addr, err),
		}
		return res, err
	}
	latency := time.Since(start).Milliseconds()
	defer client.Close()

	banner := string(client.ServerVersion())
	if banner == "" {
		banner = "SSH-2.0"
	}

	return &TunnelTestResult{
		Success:   true,
		Message:   fmt.Sprintf("SSH bastion handshake successful (%dms)", latency),
		LatencyMS: latency,
		Banner:    banner,
	}, nil
}

type TunnelManager struct {
	mu         sync.Mutex
	forwarders map[string]*ActiveForwarder
}

func NewTunnelManager() *TunnelManager {
	return &TunnelManager{
		forwarders: make(map[string]*ActiveForwarder),
	}
}

func (tm *TunnelManager) forwarderKey(cfg SSHTunnelConfig, remoteTarget string) string {
	pkHash := sha256.Sum256([]byte(cfg.PrivateKey))
	passphraseHash := sha256.Sum256([]byte(cfg.Passphrase))
	raw := fmt.Sprintf("%s:%d:%s:%s:%s:%x:%x:%s",
		cfg.Host, cfg.Port, cfg.User, cfg.AuthMethod, cfg.Password,
		pkHash[:], passphraseHash[:], remoteTarget)
	h := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(h[:])
}

// StartForwarder starts an ephemeral local TCP listener forwarding traffic to remoteTarget via SSH.
func (tm *TunnelManager) StartForwarder(cfg SSHTunnelConfig, remoteTarget string) (*ActiveForwarder, error) {
	host := strings.TrimSpace(cfg.Host)
	if err := ValidateTunnelHost(host); err != nil {
		return nil, err
	}
	port := cfg.Port
	if port <= 0 {
		port = 22
	}

	clientConfig, err := BuildSSHClientConfig(cfg)
	if err != nil {
		return nil, err
	}

	sshAddr := net.JoinHostPort(host, strconv.Itoa(port))
	sshClient, err := ssh.Dial("tcp", sshAddr, clientConfig)
	if err != nil {
		return nil, fmt.Errorf("ssh dial failed to %s: %w", sshAddr, err)
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		_ = sshClient.Close()
		return nil, fmt.Errorf("failed to bind local ephemeral listener: %w", err)
	}

	tcpAddr, ok := listener.Addr().(*net.TCPAddr)
	if !ok {
		_ = listener.Close()
		_ = sshClient.Close()
		return nil, errors.New("failed to get local TCP address")
	}

	b := make([]byte, 8)
	_, _ = rand.Read(b)
	id := hex.EncodeToString(b)

	forwarder := &ActiveForwarder{
		ID:         id,
		Listener:   listener,
		LocalPort:  tcpAddr.Port,
		LocalAddr:  listener.Addr().String(),
		RemoteAddr: remoteTarget,
		SSHClient:  sshClient,
		closed:     make(chan struct{}),
		conns:      make(map[net.Conn]struct{}),
	}

	go forwarder.serve()

	tm.mu.Lock()
	key := tm.forwarderKey(cfg, remoteTarget)
	tm.forwarders[key] = forwarder
	tm.mu.Unlock()

	return forwarder, nil
}

// GetOrCreateForwarder reuses existing active forwarder for identical target & config or starts a new one.
func (tm *TunnelManager) GetOrCreateForwarder(cfg SSHTunnelConfig, remoteTarget string) (*ActiveForwarder, error) {
	tm.mu.Lock()
	key := tm.forwarderKey(cfg, remoteTarget)
	if existing, found := tm.forwarders[key]; found {
		select {
		case <-existing.closed:
			// closed, recreate below
		default:
			tm.mu.Unlock()
			return existing, nil
		}
	}
	tm.mu.Unlock()

	return tm.StartForwarder(cfg, remoteTarget)
}

// Close closes all registered active forwarders.
func (tm *TunnelManager) Close() error {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	for k, f := range tm.forwarders {
		_ = f.Close()
		delete(tm.forwarders, k)
	}
	return nil
}

// ExtractTarget extracts the host:port from a database DSN.
func ExtractTarget(dsn string) (host string, port int, err error) {
	clean := strings.TrimSpace(dsn)
	lower := strings.ToLower(clean)

	if strings.HasPrefix(lower, "sqlite") || strings.HasPrefix(lower, "file:") || strings.HasSuffix(lower, ".db") {
		return "", 0, errors.New("sqlite does not support remote SSH tunneling")
	}

	// 1. MySQL @tcp(host:port) format
	if m := reMySQLTCP.FindStringSubmatch(clean); len(m) == 3 {
		p, pErr := strconv.Atoi(m[2])
		if pErr != nil {
			p = 3306
		}
		return m[1], p, nil
	}

	// 2. Standard URL parse (postgres:// or mysql://)
	var parseTarget = clean
	if strings.HasPrefix(lower, "mysql://") {
		parseTarget = "http://" + clean[8:]
	} else if strings.HasPrefix(lower, "postgres://") || strings.HasPrefix(lower, "postgresql://") {
		if idx := strings.Index(clean, "://"); idx != -1 {
			parseTarget = "http://" + clean[idx+3:]
		}
	}

	u, uErr := url.Parse(parseTarget)
	if uErr == nil && u.Hostname() != "" {
		h := u.Hostname()
		pStr := u.Port()
		if pStr != "" {
			p, err := strconv.Atoi(pStr)
			if err == nil {
				return h, p, nil
			}
		}
		if strings.HasPrefix(lower, "mysql") {
			return h, 3306, nil
		}
		return h, 5432, nil
	}

	return "", 0, fmt.Errorf("unable to determine target host and port from DSN: %s", dsn)
}

// RewriteDSN replaces host:port in dsn with localHost:localPort.
func RewriteDSN(dsn string, localHost string, localPort int) (string, error) {
	clean := strings.TrimSpace(dsn)
	lower := strings.ToLower(clean)

	if strings.HasPrefix(lower, "sqlite") || strings.HasPrefix(lower, "file:") {
		return dsn, nil
	}

	// 1. Check if it's MySQL tcp(...)
	if reMySQLTCP.MatchString(clean) {
		newTarget := fmt.Sprintf("tcp(%s:%d)", localHost, localPort)
		if strings.Contains(clean, "@tcp(") {
			newTarget = "@" + newTarget
		}
		return reMySQLTCP.ReplaceAllString(clean, newTarget), nil
	}

	// 2. Standard postgres/mysql URL format
	prefix := ""
	for _, p := range []string{"postgres://", "postgresql://", "mysql://"} {
		if strings.HasPrefix(lower, p) {
			prefix = clean[:len(p)]
			break
		}
	}

	if prefix != "" {
		remainder := clean[len(prefix):]
		// [user:pass@]host[:port][/path[?query]]
		var authPart, hostRest string
		if atIdx := strings.LastIndex(remainder, "@"); atIdx != -1 {
			authPart = remainder[:atIdx+1]
			hostRest = remainder[atIdx+1:]
		} else {
			hostRest = remainder
		}

		var pathQuery string
		var oldHostPort string
		if slashIdx := strings.Index(hostRest, "/"); slashIdx != -1 {
			oldHostPort = hostRest[:slashIdx]
			pathQuery = hostRest[slashIdx:]
		} else if qIdx := strings.Index(hostRest, "?"); qIdx != -1 {
			oldHostPort = hostRest[:qIdx]
			pathQuery = hostRest[qIdx:]
		} else {
			oldHostPort = hostRest
		}
		_ = oldHostPort

		newHostPort := net.JoinHostPort(localHost, strconv.Itoa(localPort))
		return prefix + authPart + newHostPort + pathQuery, nil
	}

	return clean, nil
}
