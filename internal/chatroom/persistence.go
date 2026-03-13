package chatroom

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"time"
)

// WAL - Write-ahead-log

func (cr *ChatRoom) initializePersistence() error {
	if err := os.MkdirAll(cr.dataDir, 0755); err != nil {
		return fmt.Errorf("create data dir: %w", err)
	}

	walPath := filepath.Join(cr.dataDir, "messages.wal")

	if err := cr.recoverFromWAL(walPath); err != nil {
		slog.Error("WAL recovery failed", "err", err)
	}

	file, err := os.OpenFile(walPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		return fmt.Errorf("open wal: %w", err)
	}

	cr.walFile = file
	slog.Info("WAL initialized", "path", walPath)
	go cr.runWALWorker()
	return nil
}

// runWALWorker reads from walPending, batches messages, and writes to the WAL file with periodic Sync.
// When walPending is closed (on shutdown), it flushes the remaining batch and closes walShutdownDone.
func (cr *ChatRoom) runWALWorker() {
	batchSize := cr.walBatchSize
	if batchSize <= 0 {
		batchSize = 100
	}
	syncInterval := time.Duration(cr.walSyncIntervalMs) * time.Millisecond
	if syncInterval <= 0 {
		syncInterval = time.Second
	}
	var batch []Message
	lastSync := time.Now()
	ticker := time.NewTicker(syncInterval / 2)
	defer ticker.Stop()
	flush := func() {
		if len(batch) == 0 {
			return
		}
		writeErr := false
		cr.walMu.Lock()
		for _, msg := range batch {
			data, err := json.Marshal(msg)
			if err != nil {
				slog.Error("WAL marshal error; message dropped", "msg_id", msg.ID, "err", err)
				continue
			}
			if cr.walFile != nil {
				if _, err := cr.walFile.Write(append(data, '\n')); err != nil {
					slog.Error("WAL write error", "msg_id", msg.ID, "err", err)
					writeErr = true
					break
				}
			}
		}
		if cr.walFile != nil && !writeErr {
			cr.walFile.Sync()
		}
		cr.walMu.Unlock()
		batch = batch[:0]
		lastSync = time.Now()
	}
	for {
		select {
		case msg, ok := <-cr.walPending:
			if !ok {
				flush()
				close(cr.walShutdownDone)
				return
			}
			batch = append(batch, msg)
			if len(batch) >= batchSize {
				flush()
			}
		case <-ticker.C:
			if time.Since(lastSync) >= syncInterval && len(batch) > 0 {
				flush()
			}
		}
	}
}

// enqueueWAL enqueues a message for async write to the WAL. Non-blocking; drops if queue full.
// Safe to call during shutdown (no panic if channel already closed).
func (cr *ChatRoom) enqueueWAL(msg Message) {
	if !cr.PersistMessages || cr.walPending == nil {
		return
	}
	defer func() { _ = recover() }()
	select {
	case cr.walPending <- msg:
	default:
		slog.Warn("WAL queue full; dropping message", "msg_id", msg.ID)
	}
}

func (cr *ChatRoom) recoverFromWAL(walPath string) error {
	file, err := os.Open(walPath)
	if err != nil {
		if os.IsNotExist(err) {
			slog.Info("no WAL file found; fresh start")
			return nil
		}
		return err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	recovered := 0

	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}
		var msg Message
		if err := json.Unmarshal([]byte(line), &msg); err != nil {
			slog.Warn("skipping corrupt WAL line", "line", line)
			continue
		}
		cr.messages = append(cr.messages, msg)
		if msg.ID >= cr.nextMessageID {
			cr.nextMessageID = msg.ID + 1
		}
		recovered++
	}

	slog.Info("WAL recovery complete", "messages", recovered)
	return nil
}

// persistMessage is deprecated for normal broadcast path; use enqueueWAL for async persistence.
// persistMessage remains for callers that need synchronous write (e.g. tests).
func (cr *ChatRoom) persistMessage(msg Message) error {
	if !cr.PersistMessages || cr.walFile == nil {
		return nil
	}
	cr.walMu.Lock()
	defer cr.walMu.Unlock()

	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}

	_, err = cr.walFile.Write(append(data, '\n'))
	if err != nil {
		return err
	}

	return cr.walFile.Sync()
}

func (cr *ChatRoom) createSnapshot() error {
	if !cr.PersistMessages {
		return nil
	}
	start := time.Now()
	snapshotPath := filepath.Join(cr.dataDir, "snapshot.json")
	tempPath := snapshotPath + ".tmp"

	file, err := os.OpenFile(tempPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
	if err != nil {
		return err
	}
	defer file.Close()

	// Copy under lock so we don't hold messageMu during marshal and file write.
	// If MaxMessages > 0, trim oldest messages in-place before copying.
	cr.messageMu.Lock()
	if cr.MaxMessages > 0 && len(cr.messages) > cr.MaxMessages {
		cr.messages = cr.messages[len(cr.messages)-cr.MaxMessages:]
	}
	msgCopy := make([]Message, len(cr.messages))
	copy(msgCopy, cr.messages)
	cr.messageMu.Unlock()

	data, err := json.Marshal(msgCopy)
	if err != nil {
		return err
	}

	if _, err := file.Write(data); err != nil {
		return err
	}

	if err := file.Sync(); err != nil {
		return err
	}

	file.Close()
	if err := os.Rename(tempPath, snapshotPath); err != nil {
		return err
	}

	// Fsync the parent directory so the renamed entry is durable on crash.
	if dir, err := os.Open(cr.dataDir); err == nil {
		_ = dir.Sync()
		dir.Close()
	}

	durationMs := time.Since(start).Milliseconds()
	cr.recordSnapshot(durationMs, int64(len(data)))
	cr.messageMu.Lock()
	msgCount := len(cr.messages)
	cr.messageMu.Unlock()
	slog.Info("snapshot created", "messages", msgCount)
	return cr.truncateWAL()
}

func (cr *ChatRoom) truncateWAL() error {
	cr.walMu.Lock()
	defer cr.walMu.Unlock()

	if cr.walFile != nil {
		cr.walFile.Close()
	}

	walPath := filepath.Join(cr.dataDir, "messages.wal")
	file, err := os.OpenFile(walPath, os.O_TRUNC|os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	cr.walFile = file
	slog.Info("WAL truncated")
	return nil
}

func (cr *ChatRoom) loadSnapshot() error {
	snapshotPath := filepath.Join(cr.dataDir, "snapshot.json")
	file, err := os.Open(snapshotPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		return err
	}

	cr.messageMu.Lock()
	err = json.Unmarshal(data, &cr.messages)
	cr.messageMu.Unlock()
	if err != nil {
		return err
	}

	for _, msg := range cr.messages {
		if msg.ID >= cr.nextMessageID {
			cr.nextMessageID = msg.ID + 1
		}
	}

	slog.Info("snapshot loaded", "messages", len(cr.messages))
	return nil
}

// pruneMessagesByRetention removes messages older than RetentionDays from memory,
// then rewrites the snapshot and truncates the WAL so they stay deleted after restart.
// No-op if RetentionDays <= 0.
func (cr *ChatRoom) pruneMessagesByRetention() error {
	if cr.RetentionDays <= 0 {
		return nil
	}
	start := time.Now()
	cutoff := time.Now().Add(-time.Duration(cr.RetentionDays) * 24 * time.Hour)

	cr.messageMu.Lock()
	var kept []Message
	maxID := 0
	for _, m := range cr.messages {
		if m.Timestamp.After(cutoff) {
			kept = append(kept, m)
			if m.ID > maxID {
				maxID = m.ID
			}
		}
	}
	removed := len(cr.messages) - len(kept)
	cr.messages = kept
	cr.nextMessageID = maxID + 1
	cr.messageMu.Unlock()

	if removed == 0 {
		return nil
	}
	cr.recordPrune(time.Since(start).Milliseconds(), "retention")
	slog.Info("pruned old messages", "removed", removed, "retention_days", cr.RetentionDays)
	return cr.createSnapshot()
}

// pruneMessagesByBAR removes messages whose age exceeds the sender's effective BAR (see effectiveBARMinutes).
// Runs when SessionBarMinutes > 0 or BarUserAllowed. When effective BAR is 0, message is kept.
func (cr *ChatRoom) pruneMessagesByBAR() error {
	if cr.SessionBarMinutes <= 0 && !cr.BarUserAllowed {
		return nil
	}
	start := time.Now()
	now := time.Now()

	cr.messageMu.Lock()
	var kept []Message
	maxID := 0
	for _, m := range cr.messages {
		effectiveMinutes := cr.effectiveBARMinutes(m.From)
		cutoff := now.Add(-time.Duration(effectiveMinutes) * time.Minute)
		if m.Timestamp.After(cutoff) {
			kept = append(kept, m)
			if m.ID > maxID {
				maxID = m.ID
			}
		}
	}
	removed := len(cr.messages) - len(kept)
	cr.messages = kept
	cr.nextMessageID = maxID + 1
	cr.messageMu.Unlock()

	if removed == 0 {
		return nil
	}
	cr.recordPrune(time.Since(start).Milliseconds(), "BAR")
	slog.Info("pruned messages by BAR", "removed", removed)
	return cr.createSnapshot()
}
