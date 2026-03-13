package chatroom

import (
	"fmt"
	"log/slog"
	"time"

	"github.com/Curious-Keeper/the-bar/pkg/password"
	"github.com/Curious-Keeper/the-bar/pkg/token"
)

// instanceSessionKey returns the session map key for this instance and username.
func (cr *ChatRoom) instanceSessionKey(username string) string {
	return cr.InstanceSlug + ":" + username
}

// createSession creates a new session and returns it along with the plaintext token.
// Only the hash of the token is stored; the caller must send the plaintext to the client once.
// Sessions are scoped per instance (key = instanceSlug:username).
// Returns (nil, "") if MaxSessions > 0 and the session map is at capacity.
func (cr *ChatRoom) createSession(username string) (*SessionInfo, string) {
	cr.sessionsMu.Lock()
	defer cr.sessionsMu.Unlock()

	if cr.MaxSessions > 0 && len(cr.sessions) >= cr.MaxSessions {
		slog.Warn("session capacity reached; rejecting join", "max_sessions", cr.MaxSessions, "username", username)
		return nil, ""
	}

	key := cr.instanceSessionKey(username)
	plainTok := token.GenerateToken()
	tokenHash := token.HashToken(plainTok)

	session := &SessionInfo{
		Username:  username,
		TokenHash: tokenHash,
		LastSeen:  time.Now(),
		CreatedAt: time.Now(),
	}

	cr.sessions[key] = session

	slog.Info("session created", "username", username)

	return session, plainTok
}

func (cr *ChatRoom) validateReconnectToken(username, plaintextToken string) bool {
	cr.sessionsMu.Lock()
	defer cr.sessionsMu.Unlock()

	key := cr.instanceSessionKey(username)
	session, exists := cr.sessions[key]
	if !exists {
		return false
	}

	if !token.VerifyToken(plaintextToken, session.TokenHash) {
		return false
	}

	// Enforce absolute session age limit.
	if cr.Timeouts.MaxSessionAge > 0 && time.Since(session.CreatedAt) > cr.Timeouts.MaxSessionAge {
		delete(cr.sessions, key)
		return false
	}

	if time.Since(session.LastSeen) > 1*time.Hour {
		delete(cr.sessions, key)
		return false
	}

	session.LastSeen = time.Now()

	return true
}

func (cr *ChatRoom) updateSessionActivity(username string) {
	cr.sessionsMu.Lock()
	defer cr.sessionsMu.Unlock()

	key := cr.instanceSessionKey(username)
	if session, exists := cr.sessions[key]; exists {
		session.LastSeen = time.Now()
	}
}

// ClearSessions removes all sessions in this instance (dev/testing only).
// After this, all users must join as new and will receive new reconnect tokens.
func (cr *ChatRoom) ClearSessions() {
	cr.sessionsMu.Lock()
	defer cr.sessionsMu.Unlock()
	cr.sessions = make(map[string]*SessionInfo)
	slog.Info("sessions cleared; all users must re-join")
}

func (cr *ChatRoom) isUsernameConnected(username string) bool {
	cr.roomsMu.Lock()
	defer cr.roomsMu.Unlock()
	for _, room := range cr.rooms {
		room.mu.Lock()
		for client := range room.clients {
			if client.username == username {
				room.mu.Unlock()
				return true
			}
		}
		room.mu.Unlock()
	}
	return false
}

// cleanupInactiveClients periodically removes sessions that haven't been seen
// for a long time.
func (cr *ChatRoom) cleanupInactiveClients() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		timeout := cr.Timeouts.InactivityDisconnect
		if timeout <= 0 {
			timeout = 5 * time.Minute
		}
		var toRemove []*Client
		cr.roomsMu.Lock()
		for _, room := range cr.rooms {
			room.mu.Lock()
			for client := range room.clients {
				if client.isInactive(timeout) {
					toRemove = append(toRemove, client)
				}
			}
			room.mu.Unlock()
		}
		cr.roomsMu.Unlock()
		for _, client := range toRemove {
			slog.Info("removing inactive client", "username", client.username)
		}

		// Force-close the connection first so read/write goroutines unblock,
		// then signal the event loop to remove the client from its room.
		for _, client := range toRemove {
			client.conn.Close()
			cr.leave <- client
		}

		cr.pruneRateLimitHits()
	}
}

// pruneRateLimitHits removes entries from rateLimitHits for users with no
// activity in the last second, preventing unbounded map growth on
// flood-and-disconnect workloads.
func (cr *ChatRoom) pruneRateLimitHits() {
	cr.rateLimitHitsMu.Lock()
	defer cr.rateLimitHitsMu.Unlock()
	if len(cr.rateLimitHits) == 0 {
		return
	}
	cutoff := time.Now().Add(-time.Second)
	for username, hits := range cr.rateLimitHits {
		i := 0
		for _, t := range hits {
			if t.After(cutoff) {
				hits[i] = t
				i++
			}
		}
		if i == 0 {
			delete(cr.rateLimitHits, username)
		} else {
			cr.rateLimitHits[username] = hits[:i]
		}
	}
}

// pruneExpiredSessions runs on a 10-minute ticker and removes sessions that have
// exceeded the inactivity timeout or the absolute MaxSessionAge limit.
// Started from Run() as a goroutine.
func (cr *ChatRoom) pruneExpiredSessions() {
	ticker := time.NewTicker(10 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		inactivity := cr.Timeouts.InactivityDisconnect
		if inactivity <= 0 {
			inactivity = 5 * time.Minute
		}
		maxAge := cr.Timeouts.MaxSessionAge

		cr.sessionsMu.Lock()
		for key, session := range cr.sessions {
			if time.Since(session.LastSeen) > inactivity {
				delete(cr.sessions, key)
				continue
			}
			if maxAge > 0 && time.Since(session.CreatedAt) > maxAge {
				delete(cr.sessions, key)
			}
		}
		cr.sessionsMu.Unlock()
	}
}

// --- Password skeleton (recovery key-style); not enforced at login during POC ---

// SetPassword sets an optional password and recovery key for the user in this instance.
// It returns the plaintext recovery key to show the user once; without it, account recovery is not possible.
// Caller must ensure the session exists (user has joined at least once).
func (cr *ChatRoom) SetPassword(username, plainPassword string) (recoveryKeyPlain string, err error) {
	cr.sessionsMu.Lock()
	defer cr.sessionsMu.Unlock()

	key := cr.instanceSessionKey(username)
	session, exists := cr.sessions[key]
	if !exists {
		return "", fmt.Errorf("no session for user %s", username)
	}

	hash, err := password.HashPassword(plainPassword)
	if err != nil {
		return "", err
	}
	recoveryKeyPlain = password.GenerateRecoveryKey()
	recoveryHash := password.HashRecoveryKey(recoveryKeyPlain)

	session.PasswordHash = hash
	session.RecoveryKeyHash = recoveryHash
	return recoveryKeyPlain, nil
}

// VerifyPassword returns true if the given password matches the stored hash for this user in this instance.
func (cr *ChatRoom) VerifyPassword(username, plainPassword string) bool {
	cr.sessionsMu.Lock()
	defer cr.sessionsMu.Unlock()

	key := cr.instanceSessionKey(username)
	session, exists := cr.sessions[key]
	if !exists || session.PasswordHash == "" {
		return false
	}
	return password.VerifyPassword(plainPassword, session.PasswordHash)
}

// VerifyRecoveryKey returns true if the given recovery key matches the stored hash for this user in this instance.
func (cr *ChatRoom) VerifyRecoveryKey(username, plainKey string) bool {
	cr.sessionsMu.Lock()
	defer cr.sessionsMu.Unlock()

	key := cr.instanceSessionKey(username)
	session, exists := cr.sessions[key]
	if !exists || session.RecoveryKeyHash == "" {
		return false
	}
	return password.VerifyRecoveryKey(plainKey, session.RecoveryKeyHash)
}
