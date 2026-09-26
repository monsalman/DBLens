package vault

import (
	"encoding/hex"
	"os"
	"testing"
)

func TestVault_EncryptDecryptRoundtrip(t *testing.T) {
	plaintext := []byte(`{"message":"hello zero-knowledge vault"}`)
	passphrase := "CorrectHorseBatteryStaple123!"

	params := FastKDFParams()
	container, err := EncryptPayload(plaintext, passphrase, params)
	if err != nil {
		t.Fatalf("encryption failed: %v", err)
	}

	if container.Ciphertext == "" {
		t.Fatal("expected ciphertext to be non-empty")
	}
	if container.HMAC == "" {
		t.Fatal("expected hmac to be non-empty")
	}

	decrypted, err := DecryptPayload(container, passphrase)
	if err != nil {
		t.Fatalf("decryption failed: %v", err)
	}

	if string(decrypted) != string(plaintext) {
		t.Fatalf("decrypted text mismatch: got %s, want %s", string(decrypted), string(plaintext))
	}
}

func TestVault_InvalidPassphrase(t *testing.T) {
	plaintext := []byte(`{"secret":"db-lens-vault"}`)
	passphrase := "MySecretPassphrase#2026"

	params := FastKDFParams()
	container, err := EncryptPayload(plaintext, passphrase, params)
	if err != nil {
		t.Fatalf("encryption failed: %v", err)
	}

	_, err = DecryptPayload(container, "WrongPassphrase!")
	if err == nil {
		t.Fatal("expected error when decrypting with wrong passphrase, got nil")
	}
}

func TestVault_TamperHMAC(t *testing.T) {
	plaintext := []byte(`{"vault":"secure"}`)
	passphrase := "TestVaultTamperPass!"

	params := FastKDFParams()
	container, err := EncryptPayload(plaintext, passphrase, params)
	if err != nil {
		t.Fatalf("encryption failed: %v", err)
	}

	// Flip a byte in the ciphertext
	rawCiphertext, err := hex.DecodeString(container.Ciphertext)
	if err != nil {
		t.Fatalf("failed to decode ciphertext hex: %v", err)
	}
	rawCiphertext[0] ^= 0xFF
	container.Ciphertext = hex.EncodeToString(rawCiphertext)

	_, err = DecryptPayload(container, passphrase)
	if err != ErrIntegrityCheckFailed {
		t.Fatalf("expected ErrIntegrityCheckFailed on tampered ciphertext, got: %v", err)
	}
}

func TestVault_TamperNonce(t *testing.T) {
	plaintext := []byte(`{"vault":"secure"}`)
	passphrase := "TestVaultNonceTamper!"

	params := FastKDFParams()
	container, err := EncryptPayload(plaintext, passphrase, params)
	if err != nil {
		t.Fatalf("encryption failed: %v", err)
	}

	rawNonce, err := hex.DecodeString(container.Nonce)
	if err != nil {
		t.Fatalf("failed to decode nonce hex: %v", err)
	}
	rawNonce[0] ^= 0x01
	container.Nonce = hex.EncodeToString(rawNonce)

	_, err = DecryptPayload(container, passphrase)
	if err != ErrIntegrityCheckFailed {
		t.Fatalf("expected ErrIntegrityCheckFailed on tampered nonce, got: %v", err)
	}
}

func TestVault_TamperSalt(t *testing.T) {
	plaintext := []byte(`{"vault":"secure"}`)
	passphrase := "TestVaultSaltTamper!"

	params := FastKDFParams()
	container, err := EncryptPayload(plaintext, passphrase, params)
	if err != nil {
		t.Fatalf("encryption failed: %v", err)
	}

	rawSalt, err := hex.DecodeString(container.Params.SaltHex)
	if err != nil {
		t.Fatalf("failed to decode salt: %v", err)
	}
	rawSalt[0] ^= 0x55
	container.Params.SaltHex = hex.EncodeToString(rawSalt)

	_, err = DecryptPayload(container, passphrase)
	if err != ErrIntegrityCheckFailed {
		t.Fatalf("expected ErrIntegrityCheckFailed on tampered salt, got: %v", err)
	}
}

func TestVault_EnvInterpolation(t *testing.T) {
	os.Setenv("TEST_VAULT_HOST", "192.168.1.100")
	os.Setenv("TEST_VAULT_PW", "passw0rd_xyz")
	defer os.Unsetenv("TEST_VAULT_HOST")
	defer os.Unsetenv("TEST_VAULT_PW")

	input := "postgres://admin:${TEST_VAULT_PW}@$TEST_VAULT_HOST:5432/analytics"
	res, vars := InterpolateString(input)

	expected := "postgres://admin:passw0rd_xyz@192.168.1.100:5432/analytics"
	if res != expected {
		t.Fatalf("interpolated string mismatch:\ngot  %s\nwant %s", res, expected)
	}

	if len(vars) != 2 {
		t.Fatalf("expected 2 substituted variables, got %d (%v)", len(vars), vars)
	}
}

func TestVault_SecretReferences(t *testing.T) {
	if !IsSecretReference("op://vault/prod-db/password") {
		t.Fatal("expected op:// to be recognized as secret reference")
	}
	if !IsSecretReference("pass:finance/mysql_root") {
		t.Fatal("expected pass: to be recognized as secret reference")
	}
	if IsSecretReference("plaintext-password-123") {
		t.Fatal("did not expect regular string to be secret reference")
	}
}

func TestVault_ScrubDSN(t *testing.T) {
	tests := []struct {
		name        string
		rawDSN      string
		wantClean   string
		wantPass    string
		wantScrubbed bool
	}{
		{
			name:        "PostgreSQL URL",
			rawDSN:      "postgres://postgres:SuperSecret123@localhost:5432/prod_db?sslmode=disable",
			wantClean:   "postgres://postgres:$DATABASE_PASSWORD@localhost:5432/prod_db?sslmode=disable",
			wantPass:    "SuperSecret123",
			wantScrubbed: true,
		},
		{
			name:        "MySQL DSN format",
			rawDSN:      "app_user:MySecurePwd99@tcp(10.0.0.5:3306)/ecommerce",
			wantClean:   "app_user:$DATABASE_PASSWORD@tcp(10.0.0.5:3306)/ecommerce",
			wantPass:    "MySecurePwd99",
			wantScrubbed: true,
		},
		{
			name:        "Key-value DSN format",
			rawDSN:      "host=localhost port=5432 user=dbadmin password=KVSecret456 dbname=records",
			wantClean:   "host=localhost port=5432 user=dbadmin password=$DATABASE_PASSWORD dbname=records",
			wantPass:    "KVSecret456",
			wantScrubbed: true,
		},
		{
			name:        "Already scrubbed with $ENV",
			rawDSN:      "postgres://app:$DB_PASS@127.0.0.1:5432/db",
			wantClean:   "postgres://app:$DB_PASS@127.0.0.1:5432/db",
			wantPass:    "$DB_PASS",
			wantScrubbed: false,
		},
		{
			name:        "1Password reference",
			rawDSN:      "postgres://app:op://vault/db/pass@127.0.0.1:5432/db",
			wantClean:   "postgres://app:op://vault/db/pass@127.0.0.1:5432/db",
			wantPass:    "op://vault/db/pass",
			wantScrubbed: false,
		},
		{
			name:        "Bare MySQL DSN without tcp wrapper",
			rawDSN:      "root:SecretPass99@localhost:3306/ecommerce",
			wantClean:   "root:$DATABASE_PASSWORD@localhost:3306/ecommerce",
			wantPass:    "SecretPass99",
			wantScrubbed: true,
		},
		{
			name:        "Bare MySQL DSN with slash only",
			rawDSN:      "root:SecretPass99@/ecommerce",
			wantClean:   "root:$DATABASE_PASSWORD@/ecommerce",
			wantPass:    "SecretPass99",
			wantScrubbed: true,
		},
		{
			name:        "MySQL DSN with @ in password",
			rawDSN:      "root:p@ss@word@tcp(127.0.0.1:3306)/ecommerce",
			wantClean:   "root:$DATABASE_PASSWORD@tcp(127.0.0.1:3306)/ecommerce",
			wantPass:    "p@ss@word",
			wantScrubbed: true,
		},
		{
			name:        "ODBC Key-value DSN format with Pwd=",
			rawDSN:      "Server=10.0.0.1;Uid=sa;Pwd=SecretP@ss;Database=master;",
			wantClean:   "Server=10.0.0.1;Uid=sa;Pwd=$DATABASE_PASSWORD;Database=master;",
			wantPass:    "SecretP@ss",
			wantScrubbed: true,
		},
		{
			name:        "URI DSN with special characters and @ in password",
			rawDSN:      "postgres://user:p@ss:word!#@localhost:5432/db?sslmode=disable",
			wantClean:   "postgres://user:$DATABASE_PASSWORD@localhost:5432/db?sslmode=disable",
			wantPass:    "p@ss:word!#",
			wantScrubbed: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotClean, gotPass, gotScrubbed := ScrubDSN(tt.rawDSN, "$DATABASE_PASSWORD")
			if gotScrubbed != tt.wantScrubbed {
				t.Errorf("gotScrubbed = %v, want %v", gotScrubbed, tt.wantScrubbed)
			}
			if gotClean != tt.wantClean {
				t.Errorf("gotClean = %q, want %q", gotClean, tt.wantClean)
			}
			if tt.wantPass != "" && gotPass != tt.wantPass {
				t.Errorf("gotPass = %q, want %q", gotPass, tt.wantPass)
			}
		})
	}
}

func TestVault_PolicyEnforcement(t *testing.T) {
	conns := []VaultConnection{
		{
			ID:          "conn_prod",
			Name:        "Production Primary",
			Environment: "production",
			ReadOnly:    false,
			Policy: ConnectionPolicy{
				EnforceReadOnly: false,
				RequireAuditLog: false,
			},
		},
		{
			ID:          "conn_staging",
			Name:        "Staging DB",
			Environment: "staging",
			ReadOnly:    false,
			Policy: ConnectionPolicy{
				EnforceReadOnly: true,
				RequireAuditLog: false,
			},
		},
		{
			ID:          "conn_dev",
			Name:        "Local Dev",
			Environment: "development",
			ReadOnly:    false,
		},
	}

	vaultPolicy := VaultPolicy{
		GlobalReadOnlyProd:  true,
		RequireAuditAllProd: true,
	}

	enforced, logs := EnforcePolicies(conns, vaultPolicy)

	// conn_prod should have ReadOnly=true and RequireAuditLog=true
	if !enforced[0].ReadOnly {
		t.Fatal("expected conn_prod to have ReadOnly = true")
	}
	if !enforced[0].Policy.RequireAuditLog {
		t.Fatal("expected conn_prod to have RequireAuditLog = true")
	}

	// conn_staging has connection-level EnforceReadOnly=true
	if !enforced[1].ReadOnly {
		t.Fatal("expected conn_staging to have ReadOnly = true")
	}
	if enforced[1].Policy.RequireAuditLog {
		t.Fatal("expected conn_staging not to have audit log enforced by prod policy")
	}

	// conn_dev should remain ReadOnly=false
	if enforced[2].ReadOnly {
		t.Fatal("expected conn_dev to remain ReadOnly = false")
	}

	if len(logs) == 0 {
		t.Fatal("expected audit logs generated during policy enforcement")
	}
}

func TestVault_ManagerLifecycle(t *testing.T) {
	mgr := NewManager()
	mgr.SetFastKDF(true)

	conns := []VaultConnection{
		{
			ID:          "c1",
			Name:        "Test Prod",
			Driver:      "postgres",
			DSN:         "postgres://admin:pass123@localhost:5432/test",
			Environment: "production",
		},
	}

	policy := VaultPolicy{
		GlobalReadOnlyProd: true,
	}

	// 1. Export
	expRes, err := mgr.Export(ExportRequest{
		Passphrase:     "StrongSecret2026",
		Name:           "Core DBs",
		Connections:    conns,
		Policies:       policy,
		ScrubPasswords: true,
	})
	if err != nil {
		t.Fatalf("export failed: %v", err)
	}

	// 2. Import
	impRes, err := mgr.Import(ImportRequest{
		Container:     &expRes.Container,
		Passphrase:    "StrongSecret2026",
		ApplyPolicies: true,
	})
	if err != nil {
		t.Fatalf("import failed: %v", err)
	}

	if len(impRes.Connections) != 1 {
		t.Fatalf("expected 1 imported connection, got %d", len(impRes.Connections))
	}
	if !impRes.Connections[0].ReadOnly {
		t.Fatal("expected GlobalReadOnlyProd to enforce ReadOnly on prod connection")
	}

	// 3. Unlock
	unlRes, err := mgr.Unlock(UnlockRequest{
		Container:  &expRes.Container,
		Passphrase: "StrongSecret2026",
	})
	if err != nil {
		t.Fatalf("unlock failed: %v", err)
	}
	if !unlRes.Unlocked {
		t.Fatal("expected vault to be unlocked")
	}

	// 4. Status
	status := mgr.Status()
	if !status.IsUnlocked {
		t.Fatal("status reported is_unlocked = false")
	}
	if status.ConnectionsCount != 1 {
		t.Fatalf("expected 1 loaded connection, got %d", status.ConnectionsCount)
	}

	// 5. Lock
	lockRes := mgr.Lock()
	if !lockRes.Locked {
		t.Fatal("lock failed")
	}

	statusAfterLock := mgr.Status()
	if statusAfterLock.IsUnlocked {
		t.Fatal("status reported is_unlocked = true after locking")
	}
}

func TestVault_KDFValidation_RejectsMalformedAndZero(t *testing.T) {
	// Zero KDFParams must be rejected without panic
	zeroParams := KDFParams{}
	if err := ValidateKDFParams(zeroParams); err == nil {
		t.Fatal("expected error on zero KDFParams, got nil")
	}

	// Zero params in container decrypt must return error without panicking
	container := &VaultContainer{
		Version: CurrentVaultVersion,
		KDF:     KDFArgon2id,
		Params:  zeroParams,
		Nonce:   hex.EncodeToString(make([]byte, GCMNonceLength)),
	}
	_, err := DecryptPayload(container, "some-passphrase")
	if err == nil {
		t.Fatal("expected error when decrypting container with zero KDF params")
	}

	// Invalid short salt must be rejected
	shortSaltParams := KDFParams{
		SaltHex:     "aabbcc", // 3 bytes < 16 bytes
		MemoryKB:    FastMemoryKB,
		Iterations:  FastIterations,
		Parallelism: FastParallelism,
		KeyLen:      KeyLengthTotal,
	}
	if err := ValidateKDFParams(shortSaltParams); err == nil {
		t.Fatal("expected error on short salt, got nil")
	}

	// Zero iterations must be rejected
	zeroIterParams := FastKDFParams()
	zeroIterParams.Iterations = 0
	if err := ValidateKDFParams(zeroIterParams); err == nil {
		t.Fatal("expected error on zero iterations, got nil")
	}

	// Zero parallelism must be rejected
	zeroParallelismParams := FastKDFParams()
	zeroParallelismParams.Parallelism = 0
	if err := ValidateKDFParams(zeroParallelismParams); err == nil {
		t.Fatal("expected error on zero parallelism, got nil")
	}
}

func TestVault_KDFValidation_RejectsOversizedMemory(t *testing.T) {
	// MemoryKB > 512 MB (e.g. 1 GB = 1048576 KB)
	oversized := FastKDFParams()
	oversized.MemoryKB = 1024 * 1024 // 1 GB
	if err := ValidateKDFParams(oversized); err == nil {
		t.Fatal("expected error on oversized memory (1 GB), got nil")
	}

	// DecryptPayload with oversized container params must reject before executing KDF
	container := &VaultContainer{
		Version: CurrentVaultVersion,
		KDF:     KDFArgon2id,
		Params:  oversized,
		Nonce:   hex.EncodeToString(make([]byte, GCMNonceLength)),
	}
	_, err := DecryptPayload(container, "some-passphrase")
	if err == nil {
		t.Fatal("expected error on container with oversized memory")
	}
}

func TestVault_MandatoryPolicyEnforcement_OnImport(t *testing.T) {
	mgr := NewManager()
	mgr.SetFastKDF(true)

	conns := []VaultConnection{
		{
			ID:          "conn_prod_unrestricted",
			Name:        "Production Core DB",
			Driver:      "postgres",
			DSN:         "postgres://admin:***@prod.internal:5432/core",
			Environment: "production",
			ReadOnly:    false,
		},
		{
			ID:          "conn_unauthorized_env",
			Name:        "Shadow Sandbox",
			Driver:      "postgres",
			DSN:         "postgres://admin:***@sandbox.internal:5432/test",
			Environment: "sandbox",
			ReadOnly:    false,
		},
	}

	policy := VaultPolicy{
		GlobalReadOnlyProd:  true,
		RequireAuditAllProd: true,
		AllowedEnvironments: []string{"production", "staging"},
	}

	expRes, err := mgr.Export(ExportRequest{
		Passphrase:     "MandatoryPolicyPass#1",
		Name:           "Core Vault",
		Connections:    conns,
		Policies:       policy,
		ScrubPasswords: false,
	})
	if err != nil {
		t.Fatalf("export failed: %v", err)
	}

	// Import with ApplyPolicies explicitly set to FALSE — policy enforcement MUST still occur
	impRes, err := mgr.Import(ImportRequest{
		Container:     &expRes.Container,
		Passphrase:    "MandatoryPolicyPass#1",
		ApplyPolicies: false, // Attempt to bypass policies
	})
	if err != nil {
		t.Fatalf("import failed: %v", err)
	}

	// 1. Shadow Sandbox must be filtered out because "sandbox" is not in AllowedEnvironments
	if len(impRes.Connections) != 1 {
		t.Fatalf("expected 1 connection after AllowedEnvironments filtering, got %d", len(impRes.Connections))
	}
	if impRes.Connections[0].ID != "conn_prod_unrestricted" {
		t.Fatalf("expected conn_prod_unrestricted to be retained, got %s", impRes.Connections[0].ID)
	}

	// 2. Production connection MUST have ReadOnly=true and RequireAuditLog=true enforced
	if !impRes.Connections[0].ReadOnly {
		t.Fatal("expected ReadOnly=true to be mandatorily enforced on production connection")
	}
	if !impRes.Connections[0].Policy.RequireAuditLog {
		t.Fatal("expected RequireAuditLog=true to be mandatorily enforced on production connection")
	}
}
