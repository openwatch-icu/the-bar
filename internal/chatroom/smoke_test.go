package chatroom

import (
	"testing"
	"time"
)

// TestJoinSendLeaveSmoke is a lightweight in-process smoke test: join a few clients via the
// channel path, send a message, then leave. Guards the join path and Run() loop in CI without
// requiring a real HTTP/WebSocket server. For full-stack smoke (server + WS), run the k6
// baseline script (e.g. scripts/load/00_baseline.js) against a running server.
func TestJoinSendLeaveSmoke(t *testing.T) {
	cr, err := NewChatRoom(t.TempDir(), "default", "smokecode")
	if err != nil {
		t.Fatal(err)
	}
	defer cr.shutdown()
	go cr.Run()

	// Simulate a few connections: join, then one sends a message.
	client1 := &Client{
		username:    "smoke1",
		outgoing:    make(chan string, 64),
		currentRoom: DefaultRoomName,
	}
	client2 := &Client{
		username:    "smoke2",
		outgoing:    make(chan string, 64),
		currentRoom: DefaultRoomName,
	}
	cr.join <- JoinPayload{Client: client1, RoomName: DefaultRoomName}
	cr.join <- JoinPayload{Client: client2, RoomName: DefaultRoomName}
	time.Sleep(200 * time.Millisecond)

	// One client sends a message (E2E format required).
	cr.broadcast <- BroadcastPayload{Client: client1, Message: "[smoke1]: e2e.YWVzMjU2LWdjbQ=="}
	time.Sleep(100 * time.Millisecond)

	// Both should have received something (history + broadcast).
	expectMessageContains(t, client1.outgoing, "e2e.", "smoke1")
	expectMessageContains(t, client2.outgoing, "e2e.", "smoke2")

	// Leave.
	cr.leave <- client1
	cr.leave <- client2
	time.Sleep(50 * time.Millisecond)
}
