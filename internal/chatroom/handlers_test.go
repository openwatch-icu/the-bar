package chatroom

import (
	"sync"
	"testing"
	"time"
)

func newCRWithRateLimit(t *testing.T, perSec int) *ChatRoom {
	t.Helper()
	cr, err := NewChatRoom(t.TempDir(), "default", "")
	if err != nil {
		t.Fatal(err)
	}
	cr.RateLimitPerSec = perSec
	return cr
}

func newCRWithSlowmode(t *testing.T, seconds int) *ChatRoom {
	t.Helper()
	cr, err := NewChatRoom(t.TempDir(), "default", "")
	if err != nil {
		t.Fatal(err)
	}
	cr.SlowmodeSeconds = seconds
	return cr
}

func makeClient(name string) *Client {
	return &Client{username: name, outgoing: make(chan string, 16), currentRoom: "general"}
}

// TestCheckRateLimit_BelowLimit: first N messages (< limit) are allowed.
func TestCheckRateLimit_BelowLimit(t *testing.T) {
	cr := newCRWithRateLimit(t, 3)
	defer cr.shutdown()
	c := makeClient("alice")

	for i := 0; i < 3; i++ {
		ok, msg := cr.checkSlowmodeAndRateLimit(c, "general")
		if !ok {
			t.Fatalf("call %d: expected ok=true, got rejection %q", i+1, msg)
		}
	}
}

// TestCheckRateLimit_AtLimit: the (limit+1)-th message within the window is rejected.
func TestCheckRateLimit_AtLimit(t *testing.T) {
	cr := newCRWithRateLimit(t, 3)
	defer cr.shutdown()
	c := makeClient("alice")

	for i := 0; i < 3; i++ {
		cr.checkSlowmodeAndRateLimit(c, "general")
	}
	ok, msg := cr.checkSlowmodeAndRateLimit(c, "general")
	if ok {
		t.Error("expected rejection on 4th message, got ok=true")
	}
	if msg == "" {
		t.Error("expected non-empty reject message")
	}
}

// TestCheckRateLimit_IndependentUsers: rate limit is per-user, not shared.
func TestCheckRateLimit_IndependentUsers(t *testing.T) {
	cr := newCRWithRateLimit(t, 1)
	defer cr.shutdown()
	alice := makeClient("alice")
	bob := makeClient("bob")

	// Alice hits her limit.
	cr.checkSlowmodeAndRateLimit(alice, "general")
	okAlice, _ := cr.checkSlowmodeAndRateLimit(alice, "general")
	if okAlice {
		t.Error("Alice should be rate-limited")
	}

	// Bob is unaffected.
	okBob, _ := cr.checkSlowmodeAndRateLimit(bob, "general")
	if !okBob {
		t.Error("Bob should not be rate-limited when only Alice hit the limit")
	}
}

// TestCheckSlowmode_Cooldown: second message within cooldown window is rejected.
func TestCheckSlowmode_Cooldown(t *testing.T) {
	cr := newCRWithSlowmode(t, 60) // 60s cooldown
	defer cr.shutdown()
	c := makeClient("alice")

	ok1, _ := cr.checkSlowmodeAndRateLimit(c, "general")
	if !ok1 {
		t.Fatal("first message should be allowed")
	}
	ok2, msg := cr.checkSlowmodeAndRateLimit(c, "general")
	if ok2 {
		t.Error("second message within cooldown should be rejected")
	}
	if msg == "" {
		t.Error("slowmode rejection should include remaining seconds")
	}
}

// TestCheckSlowmode_IndependentRooms: slowmode is per-room, not global.
func TestCheckSlowmode_IndependentRooms(t *testing.T) {
	cr := newCRWithSlowmode(t, 60)
	defer cr.shutdown()
	c := makeClient("alice")

	cr.checkSlowmodeAndRateLimit(c, "general")

	// Different room: should be allowed immediately.
	ok, _ := cr.checkSlowmodeAndRateLimit(c, "other")
	if !ok {
		t.Error("slowmode should not carry over to a different room")
	}
}

// TestPruneRateLimitHits_RemovesStaleEntries: entries older than 1s are removed.
func TestPruneRateLimitHits_RemovesStaleEntries(t *testing.T) {
	cr, err := NewChatRoom(t.TempDir(), "default", "")
	if err != nil {
		t.Fatal(err)
	}
	defer cr.shutdown()
	cr.RateLimitPerSec = 10

	cr.rateLimitHitsMu.Lock()
	if cr.rateLimitHits == nil {
		cr.rateLimitHits = make(map[string][]time.Time)
	}
	stale := time.Now().Add(-2 * time.Second)
	cr.rateLimitHits["ghost"] = []time.Time{stale, stale}
	cr.rateLimitHitsMu.Unlock()

	cr.pruneRateLimitHits()

	cr.rateLimitHitsMu.Lock()
	_, exists := cr.rateLimitHits["ghost"]
	cr.rateLimitHitsMu.Unlock()

	if exists {
		t.Error("expected stale rateLimitHits entry to be removed by pruneRateLimitHits")
	}
}

// TestPruneRateLimitHits_KeepsRecentEntries: entries within the last second are retained.
func TestPruneRateLimitHits_KeepsRecentEntries(t *testing.T) {
	cr, err := NewChatRoom(t.TempDir(), "default", "")
	if err != nil {
		t.Fatal(err)
	}
	defer cr.shutdown()

	cr.rateLimitHitsMu.Lock()
	if cr.rateLimitHits == nil {
		cr.rateLimitHits = make(map[string][]time.Time)
	}
	cr.rateLimitHits["active"] = []time.Time{time.Now()}
	cr.rateLimitHitsMu.Unlock()

	cr.pruneRateLimitHits()

	cr.rateLimitHitsMu.Lock()
	_, exists := cr.rateLimitHits["active"]
	cr.rateLimitHitsMu.Unlock()

	if !exists {
		t.Error("expected recent rateLimitHits entry to be kept by pruneRateLimitHits")
	}
}

// TestCheckRateLimit_Concurrent: concurrent rate-limit checks must not race (run with -race).
func TestCheckRateLimit_Concurrent(t *testing.T) {
	cr := newCRWithRateLimit(t, 100)
	defer cr.shutdown()

	const workers = 10
	var wg sync.WaitGroup
	wg.Add(workers)
	for i := 0; i < workers; i++ {
		c := makeClient("user")
		go func(cl *Client) {
			defer wg.Done()
			cr.checkSlowmodeAndRateLimit(cl, "general")
		}(c)
	}
	wg.Wait()
}
