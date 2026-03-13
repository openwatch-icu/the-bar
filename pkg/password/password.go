// Package password provides secure password hashing (bcrypt) and recovery-key helpers.
// Used for the optional Matrix-style password + one-time recovery key; not enforced during POC.
package password

import (
	"github.com/Curious-Keeper/the-bar/pkg/token"
	"golang.org/x/crypto/bcrypt"
)

const bcryptCost = bcrypt.DefaultCost

// HashPassword returns a bcrypt hash of the password for storage.
// Never store plaintext passwords.
func HashPassword(plain string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(plain), bcryptCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

// VerifyPassword returns true if plain matches the stored hash.
func VerifyPassword(plain, storedHash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(storedHash), []byte(plain))
	return err == nil
}

// GenerateRecoveryKey returns a one-time recovery key (e.g. for Matrix-style account recovery).
// Show to the user once; they must save it or lose account recovery.
func GenerateRecoveryKey() string {
	return token.GenerateToken()
}

// HashRecoveryKey returns a hash of the recovery key for storage.
func HashRecoveryKey(plainKey string) string {
	return token.HashToken(plainKey)
}

// VerifyRecoveryKey returns true if plainKey hashes to storedHash.
func VerifyRecoveryKey(plainKey, storedHash string) bool {
	return token.VerifyToken(plainKey, storedHash)
}
