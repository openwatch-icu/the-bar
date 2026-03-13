// Package token provides secure token generation and verification.
// Hash tokens before storage so a breach does not expose them; use TLS in production.
package token

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
)

// GenerateToken returns a secure random 16-byte hex token.
func GenerateToken() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// HashToken returns a hex-encoded SHA-256 hash of the token for storage.
// Do not store the plaintext token.
func HashToken(plaintext string) string {
	h := sha256.Sum256([]byte(plaintext))
	return hex.EncodeToString(h[:])
}

// VerifyToken returns true if plaintext hashes to the stored hash (constant-time comparison).
func VerifyToken(plaintext, storedHash string) bool {
	got := HashToken(plaintext)
	return subtle.ConstantTimeCompare([]byte(got), []byte(storedHash)) == 1
}
