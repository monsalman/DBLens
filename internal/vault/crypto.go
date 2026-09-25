package vault

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"golang.org/x/crypto/argon2"
)

const (
	DefaultMemoryKB    = 64 * 1024 // 64 MB
	DefaultIterations  = 3
	DefaultParallelism = 2
	KeyLengthTotal     = 64 // 32 bytes AES-256 + 32 bytes HMAC-SHA256
	SaltLength         = 16
	GCMNonceLength     = 12

	FastMemoryKB    = 1024 // 1 MB for tests
	FastIterations  = 1
	FastParallelism = 1
)

var (
	ErrInvalidPassphrase     = errors.New("invalid passphrase or corrupt vault data")
	ErrIntegrityCheckFailed  = errors.New("tamper-proofing verification failed: HMAC mismatch")
	ErrUnsupportedKDF        = errors.New("unsupported key derivation function")
	ErrInvalidContainerData  = errors.New("corrupt container parameters or encoding")
)

// DefaultKDFParams returns production-grade Argon2id parameters.
func DefaultKDFParams() KDFParams {
	salt := make([]byte, SaltLength)
	if _, err := io.ReadFull(rand.Reader, salt); err != nil {
		panic("crypto/rand unavailable: " + err.Error())
	}
	return KDFParams{
		SaltHex:     hex.EncodeToString(salt),
		MemoryKB:    DefaultMemoryKB,
		Iterations:  DefaultIterations,
		Parallelism: DefaultParallelism,
		KeyLen:      KeyLengthTotal,
	}
}

// FastKDFParams returns lightweight Argon2id parameters for test suites.
func FastKDFParams() KDFParams {
	salt := make([]byte, SaltLength)
	if _, err := io.ReadFull(rand.Reader, salt); err != nil {
		panic("crypto/rand unavailable: " + err.Error())
	}
	return KDFParams{
		SaltHex:     hex.EncodeToString(salt),
		MemoryKB:    FastMemoryKB,
		Iterations:  FastIterations,
		Parallelism: FastParallelism,
		KeyLen:      KeyLengthTotal,
	}
}

// deriveKeys computes 32-byte AES key and 32-byte HMAC key from passphrase using Argon2id.
func deriveKeys(passphrase string, p KDFParams) ([]byte, []byte, error) {
	salt, err := decodeBytes(p.SaltHex)
	if err != nil || len(salt) == 0 {
		return nil, nil, fmt.Errorf("invalid salt: %w", err)
	}

	keyLen := p.KeyLen
	if keyLen < KeyLengthTotal {
		keyLen = KeyLengthTotal
	}

	derived := argon2.IDKey(
		[]byte(passphrase),
		salt,
		p.Iterations,
		p.MemoryKB,
		p.Parallelism,
		keyLen,
	)

	aesKey := derived[:32]
	hmacKey := derived[32:64]
	return aesKey, hmacKey, nil
}

// computeHMAC calculates HMAC-SHA256 across container header, nonce, and ciphertext.
func computeHMAC(hmacKey []byte, version int, kdf string, p KDFParams, nonceHex string, ciphertextHex string) []byte {
	mac := hmac.New(sha256.New, hmacKey)
	header := fmt.Sprintf("v%d:%s:%s:%d:%d:%d:%s:%s",
		version, kdf, p.SaltHex, p.MemoryKB, p.Iterations, p.Parallelism, nonceHex, ciphertextHex)
	mac.Write([]byte(header))
	return mac.Sum(nil)
}

// decodeBytes flexibly parses hex or base64 strings.
func decodeBytes(s string) ([]byte, error) {
	s = strings.TrimSpace(s)
	if b, err := hex.DecodeString(s); err == nil {
		return b, nil
	}
	if b, err := base64.StdEncoding.DecodeString(s); err == nil {
		return b, nil
	}
	return nil, errors.New("failed to decode bytes as hex or base64")
}

// EncryptPayload derives keys, encrypts plaintext via AES-256-GCM, and binds an HMAC tag.
func EncryptPayload(plaintext []byte, passphrase string, params KDFParams) (*VaultContainer, error) {
	if params.SaltHex == "" {
		params = DefaultKDFParams()
	}

	aesKey, hmacKey, err := deriveKeys(passphrase, params)
	if err != nil {
		return nil, err
	}

	block, err := aes.NewCipher(aesKey)
	if err != nil {
		return nil, fmt.Errorf("failed to create cipher block: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize GCM mode: %w", err)
	}

	nonce := make([]byte, GCMNonceLength)
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("failed to read random nonce: %w", err)
	}

	ciphertext := gcm.Seal(nil, nonce, plaintext, nil)

	nonceHex := hex.EncodeToString(nonce)
	ciphertextHex := hex.EncodeToString(ciphertext)

	tag := computeHMAC(hmacKey, CurrentVaultVersion, KDFArgon2id, params, nonceHex, ciphertextHex)
	hmacHex := hex.EncodeToString(tag)

	return &VaultContainer{
		Version:    CurrentVaultVersion,
		KDF:        KDFArgon2id,
		Params:     params,
		Nonce:      nonceHex,
		Ciphertext: ciphertextHex,
		HMAC:       hmacHex,
		CreatedAt:  time.Now().UTC().Format(time.RFC3339),
	}, nil
}

// DecryptPayload verifies HMAC integrity and decrypts ciphertext using AES-256-GCM.
func DecryptPayload(c *VaultContainer, passphrase string) ([]byte, error) {
	if c == nil {
		return nil, errors.New("nil container")
	}
	if c.KDF != KDFArgon2id {
		return nil, fmt.Errorf("%w: %s", ErrUnsupportedKDF, c.KDF)
	}

	aesKey, hmacKey, err := deriveKeys(passphrase, c.Params)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidContainerData, err)
	}

	expectedHMAC := computeHMAC(hmacKey, c.Version, c.KDF, c.Params, c.Nonce, c.Ciphertext)
	providedHMAC, err := decodeBytes(c.HMAC)
	if err != nil {
		return nil, fmt.Errorf("%w: invalid HMAC format", ErrIntegrityCheckFailed)
	}

	// Constant time comparison for HMAC integrity
	if subtle.ConstantTimeCompare(expectedHMAC, providedHMAC) != 1 {
		return nil, ErrIntegrityCheckFailed
	}

	block, err := aes.NewCipher(aesKey)
	if err != nil {
		return nil, fmt.Errorf("failed to create cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize GCM: %w", err)
	}

	nonceBytes, err := decodeBytes(c.Nonce)
	if err != nil || len(nonceBytes) != GCMNonceLength {
		return nil, fmt.Errorf("%w: invalid nonce length", ErrInvalidContainerData)
	}

	ciphertextBytes, err := decodeBytes(c.Ciphertext)
	if err != nil {
		return nil, fmt.Errorf("%w: invalid ciphertext encoding", ErrInvalidContainerData)
	}

	plaintext, err := gcm.Open(nil, nonceBytes, ciphertextBytes, nil)
	if err != nil {
		return nil, ErrInvalidPassphrase
	}

	return plaintext, nil
}
