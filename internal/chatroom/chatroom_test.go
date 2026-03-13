package chatroom

import (
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestSessionCreateAndValidate(t *testing.T) {
	cr, err := NewChatRoom(t.TempDir(), "default", "")
	if err != nil {
		t.Fatal(err)
	}
	defer cr.shutdown()

	_, plainTok := cr.createSession("alice")
	if plainTok == "" {
		t.Fatal("createSession should return a non-empty token")
	}

	if !cr.validateReconnectToken("alice", plainTok) {
		t.Error("validateReconnectToken should accept the token returned by createSession")
	}
	if cr.validateReconnectToken("alice", "wrong-token") {
		t.Error("validateReconnectToken should reject a wrong token")
	}
	if cr.validateReconnectToken("bob", plainTok) {
		t.Error("validateReconnectToken should reject token for different username")
	}
}

func TestRoomSwitch(t *testing.T) {
	cr, err := NewChatRoom(t.TempDir(), "default", "")
	if err != nil {
		t.Fatal(err)
	}
	defer cr.shutdown()

	go cr.Run()

	client1 := &Client{
		username:    "Alice",
		outgoing:    make(chan string, 20),
		currentRoom: DefaultRoomName,
	}
	client2 := &Client{
		username:    "Bob",
		outgoing:    make(chan string, 20),
		currentRoom: DefaultRoomName,
	}

	cr.join <- JoinPayload{Client: client1, RoomName: DefaultRoomName}
	cr.join <- JoinPayload{Client: client2, RoomName: DefaultRoomName}
	time.Sleep(200 * time.Millisecond)

	// Switch client1 to room "other"
	cr.switchRoom <- JoinPayload{Client: client1, RoomName: "other"}
	time.Sleep(100 * time.Millisecond)

	// Client1 should have received "You joined #other"
	expectMessageContains(t, client1.outgoing, "You joined #other", "Client1 after switch")
	if client1.currentRoom != "other" {
		t.Errorf("client1.currentRoom = %q, want %q", client1.currentRoom, "other")
	}
}

func TestBroadcast(t *testing.T) {
	cr, _ := NewChatRoom("./testdata", "default", "")
	defer cr.shutdown()

	go cr.Run()

	// Create mock clients
	client1 := &Client{
		username: "Alice",
		outgoing: make(chan string, 10),
	}
	client2 := &Client{
		username: "Bob",
		outgoing: make(chan string, 10),
	}

	// Join clients to default room
	cr.join <- JoinPayload{Client: client1, RoomName: DefaultRoomName}
	cr.join <- JoinPayload{Client: client2, RoomName: DefaultRoomName}
	time.Sleep(200 * time.Millisecond)

	// E2E only: broadcast must use e2e. prefix + valid base64 body
	cr.broadcast <- BroadcastPayload{Client: client1, Message: "[Alice]: e2e." + "YWVzMjU2LWdjbQ=="}

	// Verify both receive it (ignore join/history noise)
	expectMessageContains(t, client1.outgoing, "e2e.", "Client1")
	expectMessageContains(t, client2.outgoing, "e2e.", "Client2")
}

func expectMessageContains(t *testing.T, ch <-chan string, substr, label string) {
	t.Helper()

	timeout := time.After(3 * time.Second)
	last := ""

	for {
		select {
		case msg := <-ch:
			last = msg
			if strings.Contains(msg, substr) {
				return
			}
		case <-timeout:
			if last == "" {
				t.Fatalf("%s didn't receive any message containing %q", label, substr)
			}
			t.Fatalf("%s didn't receive message containing %q; last message: %q", label, substr, last)
		}
	}
}

// mockLineConn is a LineConn for tests: returns fixed lines on ReadLine and records WriteLine calls.
type mockLineConn struct {
	readLines []string
	written   []string
	mu        sync.Mutex
	readIdx   int
}

func (m *mockLineConn) ReadLine() (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.readIdx >= len(m.readLines) {
		return "", nil
	}
	s := m.readLines[m.readIdx]
	m.readIdx++
	return s + "\n", nil
}

func (m *mockLineConn) WriteLine(s string) error {
	m.mu.Lock()
	m.written = append(m.written, s)
	m.mu.Unlock()
	return nil
}

func (m *mockLineConn) SetReadDeadline(time.Time) {}
func (m *mockLineConn) Close() error              { return nil }

func TestAccessCodeRequired(t *testing.T) {
	cfg := Load()
	cfg.DataDir = "./testdata"
	cfg.AccessCode = "secret"
	cfg.MinimumAge = 0 // so we don't require age confirmation in this test
	cr, err := NewChatRoomFromConfig(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer cr.shutdown()
	go cr.Run()
	time.Sleep(50 * time.Millisecond)

	// Wrong access code: should reject with "Invalid or missing access code."
	connWrong := &mockLineConn{readLines: []string{"alice accesscode:wrong"}}
	handleClient(connWrong, cr)
	connWrong.mu.Lock()
	found := false
	for _, w := range connWrong.written {
		if strings.Contains(w, "Invalid or missing access code") {
			found = true
			break
		}
	}
	connWrong.mu.Unlock()
	if !found {
		t.Errorf("expected 'Invalid or missing access code' in written lines; got %v", connWrong.written)
	}

	// Missing access code when required: should reject
	connMissing := &mockLineConn{readLines: []string{"bob"}}
	handleClient(connMissing, cr)
	connMissing.mu.Lock()
	found = false
	for _, w := range connMissing.written {
		if strings.Contains(w, "Invalid or missing access code") {
			found = true
			break
		}
	}
	connMissing.mu.Unlock()
	if !found {
		t.Errorf("expected 'Invalid or missing access code' when code missing; got %v", connMissing.written)
	}
}

func TestInputLimits(t *testing.T) {
	cfg := Load()
	cfg.DataDir = t.TempDir()
	cfg.MinimumAge = 0
	cfg.AccessCode = "testcode"
	cr, err := NewChatRoomFromConfig(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer cr.shutdown()
	go cr.Run()
	time.Sleep(50 * time.Millisecond)

	// Message too long: server should send "Message too long." (handled in readMessages)
	// We test by having a client that already joined send an overlong line. Use a mock that sends join then the long line.
	longMsg := strings.Repeat("x", MaxMessageLen+1)
	conn := &mockLineConn{readLines: []string{"alice accesscode:testcode ageconfirmed", longMsg}}
	go handleClient(conn, cr)
	time.Sleep(500 * time.Millisecond)
	conn.mu.Lock()
	gotMessageTooLong := false
	for _, w := range conn.written {
		if strings.Contains(w, "Message too long") || strings.Contains(w, "Line too long") {
			gotMessageTooLong = true
			break
		}
	}
	conn.mu.Unlock()
	if !gotMessageTooLong {
		t.Errorf("expected 'Message too long' or 'Line too long' in output for overlong message; got %v", conn.written)
	}
}

func TestLoadAllowedOriginsMerge(t *testing.T) {
	// When ALLOWED_ORIGINS is set, Load() should still include tauri://localhost and http://localhost:5173.
	save := os.Getenv("ALLOWED_ORIGINS")
	defer func() { _ = os.Setenv("ALLOWED_ORIGINS", save) }()

	_ = os.Setenv("ALLOWED_ORIGINS", "https://app.example.com")
	cfg := Load()
	hasExample := false
	hasTauri := false
	hasLocalhost := false
	for _, o := range cfg.AllowedOrigins {
		switch o {
		case "https://app.example.com":
			hasExample = true
		case "tauri://localhost":
			hasTauri = true
		case "http://localhost:5173":
			hasLocalhost = true
		}
	}
	if !hasExample {
		t.Errorf("AllowedOrigins should contain ALLOWED_ORIGINS value; got %v", cfg.AllowedOrigins)
	}
	if !hasTauri {
		t.Errorf("AllowedOrigins should always include tauri://localhost; got %v", cfg.AllowedOrigins)
	}
	if !hasLocalhost {
		t.Errorf("AllowedOrigins should always include http://localhost:5173; got %v", cfg.AllowedOrigins)
	}

	// When unset, default only (localhost:5173, tauri://localhost, https://asset.localhost)
	_ = os.Unsetenv("ALLOWED_ORIGINS")
	cfg2 := Load()
	if len(cfg2.AllowedOrigins) != 3 {
		t.Errorf("unset ALLOWED_ORIGINS: want 3 default origins; got %v", cfg2.AllowedOrigins)
	}
}
