package api_test

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/dblens/dblens/internal/api"
	"github.com/dblens/dblens/internal/connection"
	"github.com/dblens/dblens/internal/tunnel"
	"golang.org/x/crypto/ssh"
)

func startAPITestSSHServer(t *testing.T, expectedPass string) (int, func()) {
	t.Helper()

	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("failed to generate ed25519 key: %v", err)
	}
	_ = pub
	serverSigner, err := ssh.NewSignerFromKey(priv)
	if err != nil {
		t.Fatalf("failed to create signer: %v", err)
	}

	serverConfig := &ssh.ServerConfig{
		ServerVersion: "SSH-2.0-DBLensBastionAPITest_1.0",
		PasswordCallback: func(c ssh.ConnMetadata, pass []byte) (*ssh.Permissions, error) {
			if c.User() == "bastionuser" && string(pass) == expectedPass {
				return nil, nil
			}
			return nil, fmt.Errorf("invalid password")
		},
	}
	serverConfig.AddHostKey(serverSigner)

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to start listener: %v", err)
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
					_ = newChannel.Reject(ssh.Prohibited, "direct channel not allowed in test")
				}
			}(tcpConn)
		}
	}()

	cleanup := func() {
		close(done)
		_ = listener.Close()
	}

	return port, cleanup
}

func TestTestTunnelHandler(t *testing.T) {
	mgr := connection.NewManager()
	h := api.NewHandler(mgr)
	router := api.SetupRouter(h, api.RouterConfig{})

	sshPort, cleanup := startAPITestSSHServer(t, "topsecret")
	defer cleanup()

	t.Run("invalid json body returns 400", func(t *testing.T) {
		req := httptest.NewRequest("POST", "/api/tunnel/test", bytes.NewBufferString("{invalid-json"))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
		}
	})

	t.Run("missing host returns success=false", func(t *testing.T) {
		body, _ := json.Marshal(tunnel.SSHTunnelConfig{
			Enabled: true,
			User:    "bastionuser",
		})
		req := httptest.NewRequest("POST", "/api/tunnel/test", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", w.Code)
		}

		var resp struct {
			Data struct {
				Success bool   `json:"success"`
				Message string `json:"message"`
			} `json:"data"`
		}
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
		if resp.Data.Success {
			t.Fatalf("expected success=false for empty host")
		}
	})

	t.Run("blocked metadata host returns success=false", func(t *testing.T) {
		body, _ := json.Marshal(tunnel.SSHTunnelConfig{
			Enabled: true,
			Host:    "169.254.169.254",
			User:    "bastionuser",
		})
		req := httptest.NewRequest("POST", "/api/tunnel/test", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", w.Code)
		}

		var resp struct {
			Data struct {
				Success bool   `json:"success"`
				Message string `json:"message"`
			} `json:"data"`
		}
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
		if resp.Data.Success {
			t.Fatalf("expected success=false for metadata host")
		}
	})

	t.Run("valid credentials returns success=true and latency", func(t *testing.T) {
		body, _ := json.Marshal(tunnel.SSHTunnelConfig{
			Enabled:    true,
			Host:       "127.0.0.1",
			Port:       sshPort,
			User:       "bastionuser",
			AuthMethod: "password",
			Password:   "topsecret",
		})
		req := httptest.NewRequest("POST", "/api/tunnel/test", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", w.Code)
		}

		var resp struct {
			Data struct {
				Success   bool   `json:"success"`
				Message   string `json:"message"`
				LatencyMS int64  `json:"latency_ms"`
				Banner    string `json:"banner"`
			} `json:"data"`
		}
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
		if !resp.Data.Success {
			t.Fatalf("expected success=true, got: %s", resp.Data.Message)
		}
		if resp.Data.LatencyMS < 0 {
			t.Errorf("expected positive latency, got %d", resp.Data.LatencyMS)
		}
		if resp.Data.Banner != "SSH-2.0-DBLensBastionAPITest_1.0" {
			t.Errorf("unexpected banner: %s", resp.Data.Banner)
		}
	})

	t.Run("wrong password returns success=false", func(t *testing.T) {
		body, _ := json.Marshal(tunnel.SSHTunnelConfig{
			Enabled:    true,
			Host:       "127.0.0.1",
			Port:       sshPort,
			User:       "bastionuser",
			AuthMethod: "password",
			Password:   "wrongpassword",
		})
		req := httptest.NewRequest("POST", "/api/tunnel/test", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", w.Code)
		}

		var resp struct {
			Data struct {
				Success bool   `json:"success"`
				Message string `json:"message"`
			} `json:"data"`
		}
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
		if resp.Data.Success {
			t.Fatalf("expected success=false for wrong password")
		}
	})

	t.Run("test connection with failing ssh tunnel", func(t *testing.T) {
		body, _ := json.Marshal(map[string]interface{}{
			"dsn": "postgres://dbuser:dbpass@10.0.0.1:5432/proddb",
			"ssh_tunnel": tunnel.SSHTunnelConfig{
				Enabled:    true,
				Host:       "127.0.0.1",
				Port:       sshPort,
				User:       "bastionuser",
				AuthMethod: "password",
				Password:   "wrongpassword",
			},
		})
		req := httptest.NewRequest("POST", "/api/connections/test", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", w.Code)
		}

		var resp struct {
			Data struct {
				Success bool   `json:"success"`
				Message string `json:"message"`
			} `json:"data"`
		}
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
		if resp.Data.Success {
			t.Fatalf("expected test connection to fail when tunnel fails")
		}
	})
}

// Suppress unused imports
var _ = pem.EncodeToMemory
