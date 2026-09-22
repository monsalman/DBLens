package tunnel

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/pem"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
)

// generateTestKey generates an in-memory ed25519 keypair and returns private key PEM and ssh.Signer.
func generateTestKey(t *testing.T) (string, ssh.Signer) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("failed to generate ed25519 key: %v", err)
	}
	signer, err := ssh.NewSignerFromKey(priv)
	if err != nil {
		t.Fatalf("failed to create signer: %v", err)
	}

	pkcs8Bytes, err := ssh.MarshalPrivateKey(priv, "")
	if err != nil {
		t.Fatalf("failed to marshal private key: %v", err)
	}
	pemBytes := pem.EncodeToMemory(pkcs8Bytes)
	_ = pub
	return string(pemBytes), signer
}

// startTestSSHServer creates an in-process SSH server listening on 127.0.0.1:0.
func startTestSSHServer(t *testing.T, expectedPass string, clientSigner ssh.Signer) (net.Listener, int, func()) {
	t.Helper()

	serverConfig := &ssh.ServerConfig{
		ServerVersion: "SSH-2.0-DBLensTestBastion_1.0",
		PasswordCallback: func(c ssh.ConnMetadata, pass []byte) (*ssh.Permissions, error) {
			if c.User() == "testuser" && string(pass) == expectedPass {
				return nil, nil
			}
			return nil, fmt.Errorf("invalid password for %s", c.User())
		},
		PublicKeyCallback: func(c ssh.ConnMetadata, pubKey ssh.PublicKey) (*ssh.Permissions, error) {
			if clientSigner != nil && bytes.Equal(pubKey.Marshal(), clientSigner.PublicKey().Marshal()) {
				return nil, nil
			}
			return nil, fmt.Errorf("unknown public key")
		},
	}

	_, serverSigner := generateTestKey(t)
	serverConfig.AddHostKey(serverSigner)

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to start ssh listener: %v", err)
	}

	port := listener.Addr().(*net.TCPAddr).Port
	done := make(chan struct{})

	go func() {
		for {
			tcpConn, err := listener.Accept()
			if err != nil {
				select {
				case <-done:
					return
				default:
					return
				}
			}

			go func(c net.Conn) {
				sshConn, chans, reqs, err := ssh.NewServerConn(c, serverConfig)
				if err != nil {
					return
				}
				defer sshConn.Close()
				go ssh.DiscardRequests(reqs)

				for newChannel := range chans {
					if newChannel.ChannelType() == "direct-tcpip" {
						type channelData struct {
							DestAddr string
							DestPort uint32
							OrigAddr string
							OrigPort uint32
						}
						var data channelData
						if err := ssh.Unmarshal(newChannel.ExtraData(), &data); err != nil {
							_ = newChannel.Reject(ssh.ConnectionFailed, "bad extra data")
							continue
						}

						destTarget := net.JoinHostPort(data.DestAddr, strconv.Itoa(int(data.DestPort)))
						destConn, dErr := net.DialTimeout("tcp", destTarget, 3*time.Second)
						if dErr != nil {
							_ = newChannel.Reject(ssh.ConnectionFailed, dErr.Error())
							continue
						}

						ch, chReqs, chErr := newChannel.Accept()
						if chErr != nil {
							_ = destConn.Close()
							continue
						}
						go ssh.DiscardRequests(chReqs)

						var once sync.Once
						closeBoth := func() {
							_ = destConn.Close()
							_ = ch.Close()
						}
						go func() {
							_, _ = io.Copy(destConn, ch)
							once.Do(closeBoth)
						}()
						go func() {
							_, _ = io.Copy(ch, destConn)
							once.Do(closeBoth)
						}()
					} else {
						_ = newChannel.Reject(ssh.UnknownChannelType, "unsupported channel")
					}
				}
			}(tcpConn)
		}
	}()

	cleanup := func() {
		close(done)
		_ = listener.Close()
	}

	return listener, port, cleanup
}

func TestTestTunnel(t *testing.T) {
	pemKey, clientSigner := generateTestKey(t)
	_, port, cleanup := startTestSSHServer(t, "correct-pass", clientSigner)
	defer cleanup()

	t.Run("password auth success", func(t *testing.T) {
		cfg := SSHTunnelConfig{
			Enabled:    true,
			Host:       "127.0.0.1",
			Port:       port,
			User:       "testuser",
			AuthMethod: "password",
			Password:   "correct-pass",
		}
		res, err := TestTunnel(cfg)
		if err != nil {
			t.Fatalf("expected success, got error: %v", err)
		}
		if !res.Success {
			t.Fatalf("expected res.Success == true, got: %+v", res)
		}
		if res.LatencyMS < 0 {
			t.Errorf("expected positive latency, got %d", res.LatencyMS)
		}
		if res.Banner != "SSH-2.0-DBLensTestBastion_1.0" {
			t.Errorf("unexpected banner: %s", res.Banner)
		}
	})

	t.Run("password auth failure", func(t *testing.T) {
		cfg := SSHTunnelConfig{
			Enabled:    true,
			Host:       "127.0.0.1",
			Port:       port,
			User:       "testuser",
			AuthMethod: "password",
			Password:   "wrong-pass",
		}
		res, err := TestTunnel(cfg)
		if err == nil {
			t.Fatal("expected error on wrong password, got nil")
		}
		if res.Success {
			t.Fatalf("expected res.Success == false, got: %+v", res)
		}
	})

	t.Run("private key auth success", func(t *testing.T) {
		cfg := SSHTunnelConfig{
			Enabled:    true,
			Host:       "127.0.0.1",
			Port:       port,
			User:       "testuser",
			AuthMethod: "key",
			PrivateKey: pemKey,
		}
		res, err := TestTunnel(cfg)
		if err != nil {
			t.Fatalf("expected success, got error: %v", err)
		}
		if !res.Success {
			t.Fatalf("expected res.Success == true, got: %+v", res)
		}
	})

	t.Run("private key auth failure with wrong key", func(t *testing.T) {
		wrongKey, _ := generateTestKey(t)
		cfg := SSHTunnelConfig{
			Enabled:    true,
			Host:       "127.0.0.1",
			Port:       port,
			User:       "testuser",
			AuthMethod: "key",
			PrivateKey: wrongKey,
		}
		res, err := TestTunnel(cfg)
		if err == nil {
			t.Fatal("expected auth error with wrong key, got nil")
		}
		if res.Success {
			t.Fatalf("expected res.Success == false, got: %+v", res)
		}
	})

	t.Run("validation missing host and user", func(t *testing.T) {
		_, err := TestTunnel(SSHTunnelConfig{})
		if err == nil {
			t.Fatal("expected error on empty config, got nil")
		}
	})
}

func TestSSHAgentAuth(t *testing.T) {
	_, clientSigner := generateTestKey(t)
	_, port, cleanupServer := startTestSSHServer(t, "pass", clientSigner)
	defer cleanupServer()

	// Start in-process mock ssh agent listening on a temporary unix socket
	tmpDir := t.TempDir()
	sockPath := filepath.Join(tmpDir, "agent.sock")
	agentListener, err := net.Listen("unix", sockPath)
	if err != nil {
		t.Fatalf("failed to create unix listener for mock agent: %v", err)
	}
	defer agentListener.Close()

	keyring := agent.NewKeyring()
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	// Add client key that server accepts
	_ = keyring.Add(agent.AddedKey{
		PrivateKey: priv,
		Comment:    "dummy-other",
	})

	// Generate ed25519 key for agent
	pub, privKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("failed to generate key: %v", err)
	}
	agentSigner, _ := ssh.NewSignerFromKey(privKey)
	_ = pub

	// Start SSH server accepting agentSigner
	_, portAgent, cleanupAgentServer := startTestSSHServer(t, "pass", agentSigner)
	defer cleanupAgentServer()

	_ = keyring.Add(agent.AddedKey{
		PrivateKey: privKey,
		Comment:    "test-agent-key",
	})

	go func() {
		for {
			c, err := agentListener.Accept()
			if err != nil {
				return
			}
			go func(conn net.Conn) {
				_ = agent.ServeAgent(keyring, conn)
				_ = conn.Close()
			}(c)
		}
	}()

	origSock := os.Getenv("SSH_AUTH_SOCK")
	defer func() {
		if origSock != "" {
			_ = os.Setenv("SSH_AUTH_SOCK", origSock)
		} else {
			_ = os.Unsetenv("SSH_AUTH_SOCK")
		}
	}()
	_ = os.Setenv("SSH_AUTH_SOCK", sockPath)

	cfg := SSHTunnelConfig{
		Enabled:    true,
		Host:       "127.0.0.1",
		Port:       portAgent,
		User:       "testuser",
		AuthMethod: "agent",
	}

	// 1. By default, agent auth should be blocked by policy
	_ = os.Unsetenv("DBLENS_ALLOW_SSH_AGENT")
	_, err = TestTunnel(cfg)
	if err == nil || err.Error() != "SSH agent authentication disabled by server policy" {
		t.Fatalf("expected SSH agent authentication disabled by server policy, got: %v", err)
	}

	// 2. When enabled via env var, agent auth succeeds
	t.Setenv("DBLENS_ALLOW_SSH_AGENT", "true")
	res, err := TestTunnel(cfg)
	if err != nil {
		t.Fatalf("expected agent auth to succeed with env flag, got: %v", err)
	}
	if !res.Success {
		t.Fatalf("expected res.Success == true, got: %+v", res)
	}
	_ = port
}

func TestStartForwarderAndDataTransfer(t *testing.T) {
	pemKey, clientSigner := generateTestKey(t)
	_, sshPort, cleanupSSH := startTestSSHServer(t, "correct-pass", clientSigner)
	defer cleanupSSH()

	// Start echo server to act as remote DB target
	echoListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to start echo listener: %v", err)
	}
	defer echoListener.Close()
	echoPort := echoListener.Addr().(*net.TCPAddr).Port

	go func() {
		for {
			conn, err := echoListener.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				_, _ = io.Copy(c, c)
			}(conn)
		}
	}()

	tm := NewTunnelManager()
	defer tm.Close()

	cfg := SSHTunnelConfig{
		Enabled:    true,
		Host:       "127.0.0.1",
		Port:       sshPort,
		User:       "testuser",
		AuthMethod: "key",
		PrivateKey: pemKey,
	}

	targetAddr := fmt.Sprintf("127.0.0.1:%d", echoPort)
	fwd, err := tm.StartForwarder(cfg, targetAddr)
	if err != nil {
		t.Fatalf("failed to start forwarder: %v", err)
	}
	defer fwd.Close()

	if fwd.LocalPort <= 0 {
		t.Fatalf("expected valid local port, got %d", fwd.LocalPort)
	}

	// Dial forwarder and test data round-trip
	localAddr := fmt.Sprintf("127.0.0.1:%d", fwd.LocalPort)
	clientConn, err := net.DialTimeout("tcp", localAddr, 2*time.Second)
	if err != nil {
		t.Fatalf("failed to connect to forwarder: %v", err)
	}
	defer clientConn.Close()

	message := []byte("PING_OVER_SSH_TUNNEL\n")
	if _, err := clientConn.Write(message); err != nil {
		t.Fatalf("failed to write to forwarder: %v", err)
	}

	buf := make([]byte, len(message))
	if _, err := io.ReadFull(clientConn, buf); err != nil {
		t.Fatalf("failed to read echoed response from forwarder: %v", err)
	}

	if !bytes.Equal(buf, message) {
		t.Fatalf("echoed data mismatch: got %q, want %q", buf, message)
	}

	// Test GetOrCreateForwarder reuse
	fwd2, err := tm.GetOrCreateForwarder(cfg, targetAddr)
	if err != nil {
		t.Fatalf("failed to get or create forwarder: %v", err)
	}
	if fwd2.LocalPort != fwd.LocalPort {
		t.Errorf("expected forwarder reuse, got different port: %d vs %d", fwd2.LocalPort, fwd.LocalPort)
	}
}

func TestExtractTargetAndRewriteDSN(t *testing.T) {
	tests := []struct {
		dsn           string
		wantHost      string
		wantPort      int
		localPort     int
		wantRewritten string
	}{
		{
			dsn:           "postgres://user:pass@internal-db.vpc:5432/mydb?sslmode=disable",
			wantHost:      "internal-db.vpc",
			wantPort:      5432,
			localPort:     45678,
			wantRewritten: "postgres://user:pass@127.0.0.1:45678/mydb?sslmode=disable",
		},
		{
			dsn:           "postgresql://user:pass@db.private/company",
			wantHost:      "db.private",
			wantPort:      5432,
			localPort:     45678,
			wantRewritten: "postgresql://user:pass@127.0.0.1:45678/company",
		},
		{
			dsn:           "root:secret@tcp(mysql-prod.internal:3306)/appdb",
			wantHost:      "mysql-prod.internal",
			wantPort:      3306,
			localPort:     45678,
			wantRewritten: "root:secret@tcp(127.0.0.1:45678)/appdb",
		},
		{
			dsn:           "mysql://root:secret@tcp(mysql-prod.internal:3306)/appdb",
			wantHost:      "mysql-prod.internal",
			wantPort:      3306,
			localPort:     45678,
			wantRewritten: "mysql://root:secret@tcp(127.0.0.1:45678)/appdb",
		},
	}

	for _, tt := range tests {
		t.Run(tt.dsn, func(t *testing.T) {
			h, p, err := ExtractTarget(tt.dsn)
			if err != nil {
				t.Fatalf("ExtractTarget failed: %v", err)
			}
			if h != tt.wantHost || p != tt.wantPort {
				t.Errorf("ExtractTarget got %s:%d, want %s:%d", h, p, tt.wantHost, tt.wantPort)
			}

			rewritten, err := RewriteDSN(tt.dsn, "127.0.0.1", tt.localPort)
			if err != nil {
				t.Fatalf("RewriteDSN failed: %v", err)
			}
			if rewritten != tt.wantRewritten {
				t.Errorf("RewriteDSN got %q, want %q", rewritten, tt.wantRewritten)
			}
		})
	}
}

func TestValidateTunnelHost(t *testing.T) {
	tests := []struct {
		host    string
		blocked bool
	}{
		{"127.0.0.1", false},
		{"bastion.example.com", false},
		{"10.0.0.1", false},
		{"169.254.169.254", true},
		{"169.254.1.1", true},
		{"169.254.254.254", true},
		{"metadata.google.internal", true},
		{"foo.metadata.google.internal", true},
		{"instance-data", true},
		{"api.instance-data", true},
		{"", true},
	}

	for _, tc := range tests {
		err := ValidateTunnelHost(tc.host)
		if tc.blocked && err == nil {
			t.Errorf("expected host %q to be blocked, but was allowed", tc.host)
		}
		if !tc.blocked && err != nil {
			t.Errorf("expected host %q to be allowed, but got: %v", tc.host, err)
		}
	}
}

func TestForwarderKey_Isolation(t *testing.T) {
	tm := NewTunnelManager()

	cfg1 := SSHTunnelConfig{
		Host:       "10.0.0.1",
		Port:       22,
		User:       "user",
		AuthMethod: "key",
		PrivateKey: "key-A",
	}

	cfg2 := SSHTunnelConfig{
		Host:       "10.0.0.1",
		Port:       22,
		User:       "user",
		AuthMethod: "key",
		PrivateKey: "key-B",
	}

	k1 := tm.forwarderKey(cfg1, "remote:5432")
	k2 := tm.forwarderKey(cfg2, "remote:5432")

	if k1 == k2 {
		t.Fatalf("expected different forwarder keys for different private keys, got %s", k1)
	}
}
