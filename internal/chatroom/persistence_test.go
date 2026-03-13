package chatroom

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func persistCfg(t *testing.T) ServerConfig {
	t.Helper()
	cfg := ServerConfig{
		DataDir:           t.TempDir(),
		InstanceSlug:      "default",
		PersistMessages:   true,
		WALBatchSize:      100,
		WALSyncIntervalMs: 1000,
	}
	return cfg
}

// TestWALRecoverFromCorruptLines: a WAL with corrupt lines should skip them
// and recover only valid messages.
func TestWALRecoverFromCorruptLines(t *testing.T) {
	dir := t.TempDir()
	walPath := filepath.Join(dir, "messages.wal")

	now := time.Now()
	valid1 := Message{ID: 1, From: "alice", Content: "e2e.aaa", Timestamp: now, Channel: "general"}
	valid2 := Message{ID: 2, From: "bob", Content: "e2e.bbb", Timestamp: now, Channel: "general"}

	f, err := os.Create(walPath)
	if err != nil {
		t.Fatal(err)
	}
	b1, _ := json.Marshal(valid1)
	f.Write(append(b1, '\n'))
	f.Write([]byte("this is not valid JSON\n"))
	f.Write([]byte("\n")) // blank line (should be skipped)
	b2, _ := json.Marshal(valid2)
	f.Write(append(b2, '\n'))
	f.Close()

	cfg := persistCfg(t)
	cfg.DataDir = dir
	cr, err := NewChatRoomFromConfig(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer cr.shutdown()

	cr.messageMu.Lock()
	count := len(cr.messages)
	cr.messageMu.Unlock()

	if count != 2 {
		t.Errorf("expected 2 recovered messages, got %d", count)
	}
	if cr.nextMessageID != 3 {
		t.Errorf("expected nextMessageID=3, got %d", cr.nextMessageID)
	}
}

// TestSnapshotCreateAndLoad: messages written to snapshot survive a restart.
func TestSnapshotCreateAndLoad(t *testing.T) {
	cfg := persistCfg(t)
	cr, err := NewChatRoomFromConfig(cfg)
	if err != nil {
		t.Fatal(err)
	}

	now := time.Now()
	cr.messageMu.Lock()
	cr.messages = []Message{
		{ID: 1, From: "alice", Content: "e2e.hello", Timestamp: now, Channel: "general"},
		{ID: 2, From: "bob", Content: "e2e.world", Timestamp: now, Channel: "general"},
	}
	cr.nextMessageID = 3
	cr.messageMu.Unlock()

	if err := cr.createSnapshot(); err != nil {
		t.Fatalf("createSnapshot: %v", err)
	}
	cr.shutdown()

	// Second instance reads the snapshot.
	cfg2 := cfg
	cr2, err := NewChatRoomFromConfig(cfg2)
	if err != nil {
		t.Fatal(err)
	}
	defer cr2.shutdown()

	cr2.messageMu.Lock()
	count := len(cr2.messages)
	cr2.messageMu.Unlock()

	if count != 2 {
		t.Errorf("expected 2 messages loaded from snapshot, got %d", count)
	}
}

// TestWALTruncatedAfterSnapshot: after createSnapshot succeeds the WAL file
// should be empty (truncated).
func TestWALTruncatedAfterSnapshot(t *testing.T) {
	cfg := persistCfg(t)
	cr, err := NewChatRoomFromConfig(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer cr.shutdown()

	now := time.Now()
	cr.messageMu.Lock()
	cr.messages = []Message{
		{ID: 1, From: "alice", Content: "e2e.hello", Timestamp: now, Channel: "general"},
	}
	cr.nextMessageID = 2
	cr.messageMu.Unlock()

	if err := cr.createSnapshot(); err != nil {
		t.Fatalf("createSnapshot: %v", err)
	}

	walPath := filepath.Join(cfg.DataDir, "messages.wal")
	info, err := os.Stat(walPath)
	if err != nil {
		t.Fatalf("stat WAL: %v", err)
	}
	if info.Size() != 0 {
		t.Errorf("WAL should be empty after snapshot, got %d bytes", info.Size())
	}
}

// TestSnapshotMaxMessages: when MaxMessages is set, createSnapshot trims oldest.
func TestSnapshotMaxMessages(t *testing.T) {
	cfg := persistCfg(t)
	cfg.MaxMessages = 2
	cr, err := NewChatRoomFromConfig(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer cr.shutdown()

	now := time.Now()
	cr.messageMu.Lock()
	cr.messages = []Message{
		{ID: 1, From: "a", Content: "e2e.1", Timestamp: now, Channel: "general"},
		{ID: 2, From: "b", Content: "e2e.2", Timestamp: now, Channel: "general"},
		{ID: 3, From: "c", Content: "e2e.3", Timestamp: now, Channel: "general"},
	}
	cr.nextMessageID = 4
	cr.messageMu.Unlock()

	if err := cr.createSnapshot(); err != nil {
		t.Fatalf("createSnapshot: %v", err)
	}

	cr.messageMu.Lock()
	count := len(cr.messages)
	first := cr.messages[0].ID
	cr.messageMu.Unlock()

	if count != 2 {
		t.Errorf("expected 2 messages after MaxMessages trim, got %d", count)
	}
	if first != 2 {
		t.Errorf("expected oldest trimmed (first ID=2), got ID=%d", first)
	}
}

// TestWALEnqueueDoesNotPanicAfterShutdown: enqueueWAL after channel close must
// not panic (deferred recover in enqueueWAL).
func TestWALEnqueueDoesNotPanicAfterShutdown(t *testing.T) {
	cfg := persistCfg(t)
	cr, err := NewChatRoomFromConfig(cfg)
	if err != nil {
		t.Fatal(err)
	}
	cr.shutdown()

	// Should not panic even though walPending is closed.
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("enqueueWAL panicked after shutdown: %v", r)
		}
	}()
	cr.enqueueWAL(Message{ID: 99, From: "ghost", Content: "e2e.x"})
}
