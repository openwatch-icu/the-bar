package chatroom

import (
	"sync"
	"testing"
	"time"
)

// TestValidateReconnectToken_ExpiredLastSeen: token rejected when LastSeen > 1h ago.
func TestValidateReconnectToken_ExpiredLastSeen(t *testing.T) {
	cr, err := NewChatRoom(t.TempDir(), "default", "")
	if err != nil {
		t.Fatal(err)
	}
	defer cr.shutdown()

	_, tok := cr.createSession("alice")
	if tok == "" {
		t.Fatal("createSession returned empty token")
	}

	// Back-date the session's LastSeen beyond the 1h inactivity limit.
	cr.sessionsMu.Lock()
	key := cr.instanceSessionKey("alice")
	cr.sessions[key].LastSeen = time.Now().Add(-2 * time.Hour)
	cr.sessionsMu.Unlock()

	if cr.validateReconnectToken("alice", tok) {
		t.Error("expected token to be rejected when LastSeen > 1h, but it was accepted")
	}

	// Session should have been deleted.
	cr.sessionsMu.Lock()
	_, exists := cr.sessions[key]
	cr.sessionsMu.Unlock()
	if exists {
		t.Error("session should be deleted after expired-LastSeen rejection")
	}
}

// TestValidateReconnectToken_ExpiredMaxAge: token rejected when CreatedAt exceeds MaxSessionAge.
func TestValidateReconnectToken_ExpiredMaxAge(t *testing.T) {
	cr, err := NewChatRoom(t.TempDir(), "default", "")
	if err != nil {
		t.Fatal(err)
	}
	defer cr.shutdown()

	cr.Timeouts.MaxSessionAge = 1 * time.Millisecond

	_, tok := cr.createSession("bob")
	if tok == "" {
		t.Fatal("createSession returned empty token")
	}

	// Back-date CreatedAt so it exceeds MaxSessionAge.
	cr.sessionsMu.Lock()
	key := cr.instanceSessionKey("bob")
	cr.sessions[key].CreatedAt = time.Now().Add(-1 * time.Hour)
	cr.sessionsMu.Unlock()

	if cr.validateReconnectToken("bob", tok) {
		t.Error("expected token to be rejected when CreatedAt exceeds MaxSessionAge")
	}
}

// TestCreateSession_MaxSessionsCap: createSession returns ("", "") when at capacity.
func TestCreateSession_MaxSessionsCap(t *testing.T) {
	cr, err := NewChatRoom(t.TempDir(), "default", "")
	if err != nil {
		t.Fatal(err)
	}
	defer cr.shutdown()

	cr.MaxSessions = 2
	cr.createSession("u1")
	cr.createSession("u2")

	// Third create should be rejected.
	session, tok := cr.createSession("u3")
	if tok != "" || session != nil {
		t.Error("expected capacity rejection (nil, \"\"), got a session")
	}
}

// TestCreateSession_Concurrent: concurrent creates must not race (run with -race).
func TestCreateSession_Concurrent(t *testing.T) {
	cr, err := NewChatRoom(t.TempDir(), "default", "")
	if err != nil {
		t.Fatal(err)
	}
	defer cr.shutdown()

	const workers = 20
	var wg sync.WaitGroup
	wg.Add(workers)
	for i := 0; i < workers; i++ {
		name := "user" + string(rune('a'+i))
		go func(n string) {
			defer wg.Done()
			cr.createSession(n)
		}(name)
	}
	wg.Wait()

	cr.sessionsMu.Lock()
	count := len(cr.sessions)
	cr.sessionsMu.Unlock()
	if count != workers {
		t.Errorf("expected %d sessions, got %d", workers, count)
	}
}

// TestValidateReconnectToken_WrongToken: wrong token is rejected without deleting session.
func TestValidateReconnectToken_WrongToken(t *testing.T) {
	cr, err := NewChatRoom(t.TempDir(), "default", "")
	if err != nil {
		t.Fatal(err)
	}
	defer cr.shutdown()

	_, tok := cr.createSession("carol")
	if tok == "" {
		t.Fatal("createSession returned empty token")
	}

	if cr.validateReconnectToken("carol", "completely-wrong") {
		t.Error("wrong token should be rejected")
	}

	// Session should still exist.
	cr.sessionsMu.Lock()
	key := cr.instanceSessionKey("carol")
	_, exists := cr.sessions[key]
	cr.sessionsMu.Unlock()
	if !exists {
		t.Error("session should persist after a wrong-token rejection")
	}
}
