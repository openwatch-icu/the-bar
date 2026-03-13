package chatroom

import (
	"encoding/base64"
	"fmt"
	"log/slog"
	"strings"
	"time"
)

// effectiveBARMinutes returns the effective BAR in minutes for the given sender (for pruning and burn timestamp).
// When BarUserAllowed: returns the user's set BAR (or 0 if they have not set one). When !BarUserAllowed: returns SessionBarMinutes (or 0).
func (cr *ChatRoom) effectiveBARMinutes(username string) int {
	if cr.BarUserAllowed {
		cr.userBarMu.Lock()
		m, ok := cr.userBarMinutes[username]
		cr.userBarMu.Unlock()
		if ok {
			return m
		}
		return 0
	}
	if cr.SessionBarMinutes > 0 {
		return cr.SessionBarMinutes
	}
	return 0
}

// getOrCreateRoom returns the room by name, creating it if it doesn't exist. Caller must hold cr.roomsMu when appropriate; getOrCreateRoom locks internally.
// Rooms whose name starts with PrivateRoomPrefix are created with IsPrivate=true and are hidden from /rooms.
func (cr *ChatRoom) getOrCreateRoom(name string) *Room {
	cr.roomsMu.Lock()
	defer cr.roomsMu.Unlock()
	if r, ok := cr.rooms[name]; ok {
		return r
	}
	isPrivate := strings.HasPrefix(name, PrivateRoomPrefix)
	r := &Room{
		name:      name,
		clients:   make(map[*Client]bool),
		IsPrivate: isPrivate,
	}
	cr.rooms[name] = r
	return r
}

// getRoom returns the room by name or nil. Caller may hold cr.roomsMu.
func (cr *ChatRoom) getRoom(name string) *Room {
	cr.roomsMu.Lock()
	defer cr.roomsMu.Unlock()
	return cr.rooms[name]
}

// handleSwitchRoom moves a client from their current room to another (without disconnecting).
func (cr *ChatRoom) handleSwitchRoom(payload JoinPayload) {
	client := payload.Client
	newRoomName := payload.RoomName
	if newRoomName == "" {
		newRoomName = DefaultRoomName
	}
	oldRoomName := client.currentRoom
	if oldRoomName == "" {
		oldRoomName = DefaultRoomName
	}
	if oldRoomName == newRoomName {
		select {
		case client.outgoing <- fmt.Sprintf("Already in #%s\n", newRoomName):
		default:
		}
		return
	}
	// Remove from old room
	if old := cr.getRoom(oldRoomName); old != nil {
		old.mu.Lock()
		delete(old.clients, client)
		old.mu.Unlock()
		cr.broadcastRoom(oldRoomName, fmt.Sprintf("*** %s left the channel ***\n", client.username))
	}
	// Add to new room
	room := cr.getOrCreateRoom(newRoomName)
	room.mu.Lock()
	room.clients[client] = true
	room.mu.Unlock()
	client.currentRoom = newRoomName
	client.markActive()
	cr.broadcastRoom(newRoomName, fmt.Sprintf("*** %s joined the channel ***\n", client.username))
	msg := fmt.Sprintf("You joined #%s\n", newRoomName)
	select {
	case client.outgoing <- msg:
	default:
	}
	if blob := cr.getWrappedRoomKey(newRoomName); blob != "" {
		keyLine := fmt.Sprintf("wrappedroomkey:#%s:%s\n", newRoomName, blob)
		select {
		case client.outgoing <- keyLine:
		default:
		}
	}
	cr.sendHistory(client, 10)
}

// handleJoin adds a client to the given room and broadcasts a join message in that room.
// It also delivers any pending offline DMs for this user.
// Welcome and command list are sent via client.outgoing (writer goroutine already running).
func (cr *ChatRoom) handleJoin(payload JoinPayload) {
	client := payload.Client
	roomName := payload.RoomName
	if roomName == "" {
		roomName = DefaultRoomName
	}

	room := cr.getOrCreateRoom(roomName)
	room.mu.Lock()
	room.clients[client] = true
	room.mu.Unlock()

	client.currentRoom = roomName
	client.markActive()

	// Send Welcome first so client sees it as soon as join is processed (writer already running).
	select {
	case client.outgoing <- buildWelcomeMessage(client.username):
	default:
	}

	room.mu.Lock()
	count := len(room.clients)
	room.mu.Unlock()
	slog.Info("user joined room", "username", client.username, "room", roomName, "count", count)

	// Deliver pending offline DMs for this user
	cr.dmInboxMu.Lock()
	pending := cr.dmInbox[client.username]
	if len(pending) > 0 {
		cr.dmInbox[client.username] = nil
	}
	cr.dmInboxMu.Unlock()
deliverPending:
	for _, rec := range pending {
		msg := fmt.Sprintf("[From %s]: %s\n", rec.From, rec.Content)
		select {
		case client.outgoing <- msg:
		default:
			break deliverPending
		}
	}

	// Send room key before history so joiners can decrypt history when it arrives
	if blob := cr.getWrappedRoomKey(roomName); blob != "" {
		keyLine := fmt.Sprintf("wrappedroomkey:#%s:%s\n", roomName, blob)
		select {
		case client.outgoing <- keyLine:
		default:
		}
	}
	cr.sendHistory(client, 10)

	slug := cr.InstanceSlug
	if slug == "" {
		slug = "this"
	}
	// Notify only the room the user joined (O(room size)), not every client on the instance.
	cr.broadcastRoom(roomName, fmt.Sprintf("welcome:[%s] joined `%s` server\n", client.username, slug))
}

func (cr *ChatRoom) handleLeave(client *Client) {
	roomName := client.currentRoom
	if roomName == "" {
		roomName = DefaultRoomName
	}
	room := cr.getRoom(roomName)
	if room != nil {
		room.mu.Lock()
		delete(room.clients, client)
		room.mu.Unlock()
		slog.Info("user left room", "username", client.username, "room", roomName)
	}

	// Close exactly once; a second handleLeave call (e.g. inactivity + read return) is a no-op.
	client.closeOnce.Do(func() { close(client.outgoing) })

	announcement := fmt.Sprintf("*** %s left the chat ***\n", client.username)
	// Broadcast to the room they left (no client ref for "system" - send to room only)
	cr.broadcastRoom(roomName, announcement)
}

// broadcastRoom sends a message to all clients in a room (used for leave announcements).
func (cr *ChatRoom) broadcastRoom(roomName, message string) {
	room := cr.getRoom(roomName)
	if room == nil {
		return
	}
	room.mu.Lock()
	clients := make([]*Client, 0, len(room.clients))
	for c := range room.clients {
		clients = append(clients, c)
	}
	room.mu.Unlock()
	for _, c := range clients {
		select {
		case c.outgoing <- message:
		default:
		}
	}
}

// broadcastAll sends a message to every connected client (e.g. for the read-only Welcome channel).
func (cr *ChatRoom) broadcastAll(message string) {
	cr.roomsMu.Lock()
	all := make([]*Client, 0)
	for _, room := range cr.rooms {
		room.mu.Lock()
		for c := range room.clients {
			all = append(all, c)
		}
		room.mu.Unlock()
	}
	cr.roomsMu.Unlock()
	for _, c := range all {
		select {
		case c.outgoing <- message:
		default:
		}
	}
}

// checkSlowmodeAndRateLimit returns (true, "") if the client can send, or (false, rejectMsg) to send to the client.
func (cr *ChatRoom) checkSlowmodeAndRateLimit(client *Client, roomName string) (ok bool, rejectMsg string) {
	now := time.Now()
	username := client.username

	// Global rate limit: checked first so per-user counters are not consumed on global reject.
	if cr.GlobalRateLimitPerSec > 0 {
		cr.globalRateLimitHitsMu.Lock()
		cutoff := now.Add(-time.Second)
		i := 0
		for _, t := range cr.globalRateLimitHits {
			if t.After(cutoff) {
				cr.globalRateLimitHits[i] = t
				i++
			}
		}
		cr.globalRateLimitHits = cr.globalRateLimitHits[:i]
		if len(cr.globalRateLimitHits) >= cr.GlobalRateLimitPerSec {
			cr.globalRateLimitHitsMu.Unlock()
			return false, "Server rate limited. Try again in a moment.\n"
		}
		cr.globalRateLimitHits = append(cr.globalRateLimitHits, now)
		cr.globalRateLimitHitsMu.Unlock()
	}

	// Per-user rate limit: prune old hits, then check count
	if cr.RateLimitPerSec > 0 {
		cr.rateLimitHitsMu.Lock()
		if cr.rateLimitHits == nil {
			cr.rateLimitHits = make(map[string][]time.Time)
		}
		cutoff := now.Add(-time.Second)
		hits := cr.rateLimitHits[username]
		i := 0
		for _, t := range hits {
			if t.After(cutoff) {
				hits[i] = t
				i++
			}
		}
		hits = hits[:i]
		if len(hits) >= cr.RateLimitPerSec {
			cr.rateLimitHitsMu.Unlock()
			return false, "Rate limited. Try again in a moment.\n"
		}
		hits = append(hits, now)
		cr.rateLimitHits[username] = hits
		cr.rateLimitHitsMu.Unlock()
	}

	// Slowmode: per-room cooldown per user
	if cr.SlowmodeSeconds > 0 {
		cr.lastRoomMessageAtMu.Lock()
		if cr.lastRoomMessageAt == nil {
			cr.lastRoomMessageAt = make(map[string]map[string]time.Time)
		}
		if cr.lastRoomMessageAt[username] == nil {
			cr.lastRoomMessageAt[username] = make(map[string]time.Time)
		}
		last := cr.lastRoomMessageAt[username][roomName]
		elapsed := int(now.Sub(last).Seconds())
		if elapsed < cr.SlowmodeSeconds && !last.IsZero() {
			remaining := cr.SlowmodeSeconds - elapsed
			cr.lastRoomMessageAtMu.Unlock()
			return false, fmt.Sprintf("slowmode:%d\n", remaining)
		}
		cr.lastRoomMessageAt[username][roomName] = now
		cr.lastRoomMessageAtMu.Unlock()
	}

	return true, ""
}

// isValidE2EContent returns true if content is the E2E wire format: "e2e." followed by valid base64.
// E2E is the only accepted format; no plaintext.
func isValidE2EContent(content string) bool {
	content = strings.TrimSpace(content)
	if !strings.HasPrefix(content, E2EPrefix) {
		return false
	}
	b64 := strings.TrimSpace(content[len(E2EPrefix):])
	if len(b64) == 0 {
		return false
	}
	_, err := base64.StdEncoding.DecodeString(b64)
	return err == nil
}

// handleBroadcast records a chat message to the client's current room and forwards to all clients in that room.
// E2E only: the message body must start with E2EPrefix and valid base64; otherwise the message is rejected.
func (cr *ChatRoom) handleBroadcast(payload BroadcastPayload) {
	cr.addStatsMsgIn()
	client := payload.Client
	message := payload.Message
	roomName := client.currentRoom
	if roomName == "" {
		roomName = DefaultRoomName
	}

	if ok, rejectMsg := cr.checkSlowmodeAndRateLimit(client, roomName); !ok {
		select {
		case client.outgoing <- rejectMsg:
		default:
		}
		return
	}

	// E2E only: extract content (after "[User]: ") and reject if not valid E2E format.
	parts := strings.SplitN(message, ": ", 2)
	if len(parts) != 2 {
		select {
		case client.outgoing <- "Only encrypted messages are accepted. Ensure your client has the room key.\n":
		default:
		}
		return
	}
	content := strings.TrimSpace(parts[1])
	if !isValidE2EContent(content) {
		select {
		case client.outgoing <- "Only encrypted messages are accepted. Ensure your client has the room key.\n":
		default:
		}
		return
	}

	from := strings.Trim(parts[0], "[]")
	actualContent := message

	cr.messageMu.Lock()
	msg := Message{
		ID:        cr.nextMessageID,
		From:      from,
		Content:   actualContent,
		Timestamp: time.Now(),
		Channel:   roomName,
	}
	cr.nextMessageID++
	cr.messages = append(cr.messages, msg)
	cr.messageMu.Unlock()

	cr.enqueueWAL(msg)

	cr.mu.Lock()
	cr.totalMessages++
	cr.mu.Unlock()

	room := cr.getRoom(roomName)
	if room == nil {
		return
	}
	room.mu.Lock()
	clients := make([]*Client, 0, len(room.clients))
	for c := range room.clients {
		clients = append(clients, c)
	}
	room.mu.Unlock()

	// When BAR is in use, prefix with [ts:...] [burn:...] so clients can hide when burned
	outgoingMsg := message
	if cr.SessionBarMinutes > 0 || cr.BarUserAllowed {
		effMin := cr.effectiveBARMinutes(from)
		if effMin > 0 {
			burnAt := msg.Timestamp.Add(time.Duration(effMin) * time.Minute)
			outgoingMsg = fmt.Sprintf("[ts:%d] [burn:%d] %s", msg.Timestamp.UnixMilli(), burnAt.UnixMilli(), message)
		}
	}

	if !cr.ReduceLogRate {
		slog.Debug("broadcasting E2E message", "room", roomName, "clients", len(clients))
	}

	// Fan out in parallel so one slow client doesn't block the runLoop
	for _, c := range clients {
		c := c
		go func() {
			select {
			case c.outgoing <- outgoingMsg:
				cr.addStatsMsgOut()
				c.mu.Lock()
				c.messagesSent++
				c.mu.Unlock()
			default:
				cr.addStatsSkipped()
				if !cr.ReduceLogRate {
					slog.Warn("outgoing channel full; message skipped", "username", c.username)
				}
			}
		}()
	}
}

func (cr *ChatRoom) sendHistory(client *Client, count int) {
	roomName := client.currentRoom
	if roomName == "" {
		roomName = DefaultRoomName
	}
	cr.messageMu.Lock()
	defer cr.messageMu.Unlock()

	// Filter messages for this room (newest last)
	var roomMessages []Message
	for i := range cr.messages {
		if cr.messages[i].Channel == roomName {
			roomMessages = append(roomMessages, cr.messages[i])
		}
	}
	start := len(roomMessages) - count
	if start < 0 {
		start = 0
	}
	historyMsg := fmt.Sprintf("Recent messages [#%s]:\n", roomName)
	for i := start; i < len(roomMessages); i++ {
		m := roomMessages[i]
		line := fmt.Sprintf(" [%s]: %s\n", m.From, m.Content)
		if cr.SessionBarMinutes > 0 || cr.BarUserAllowed {
			effMin := cr.effectiveBARMinutes(m.From)
			if effMin > 0 {
				burnAt := m.Timestamp.Add(time.Duration(effMin) * time.Minute)
				line = fmt.Sprintf("[ts:%d] [burn:%d] %s", m.Timestamp.UnixMilli(), burnAt.UnixMilli(), line)
			}
		}
		historyMsg += line
	}
	select {
	case client.outgoing <- historyMsg:
	default:
	}
}

func (cr *ChatRoom) sendUserList(client *Client) {
	roomName := client.currentRoom
	if roomName == "" {
		roomName = DefaultRoomName
	}
	room := cr.getRoom(roomName)
	if room == nil {
		select {
		case client.outgoing <- "You are not in a room.\n":
		default:
		}
		return
	}

	room.mu.Lock()
	clients := make([]*Client, 0, len(room.clients))
	for c := range room.clients {
		clients = append(clients, c)
	}
	room.mu.Unlock()

	cr.mu.Lock()
	totalMsg := cr.totalMessages
	uptime := time.Since(cr.startTime).Round(time.Second)
	cr.mu.Unlock()

	idleTimeout := cr.Timeouts.IdleLabel
	if idleTimeout <= 0 {
		idleTimeout = 1 * time.Minute
	}
	list := fmt.Sprintf("Users in #%s:\n", roomName)
	for _, c := range clients {
		status := ""
		if c.isInactive(idleTimeout) {
			status = " (idle)"
		}
		list += fmt.Sprintf("  - %s%s\n", c.username, status)
	}
	list += fmt.Sprintf("\nTotal messages: %d | Uptime: %s\n", totalMsg, uptime)

	select {
	case client.outgoing <- list:
	default:
		slog.Warn("failed to send user list; client channel full", "username", client.username)
	}
}

func (cr *ChatRoom) handleDirectMessage(dm DirectMessage) {
	select {
	case dm.toClient.outgoing <- dm.message:
		dm.toClient.mu.Lock()
		dm.toClient.messagesSent++
		dm.toClient.mu.Unlock()
	default:
		slog.Warn("failed to deliver DM; client channel full", "username", dm.toClient.username)
	}
}

// findClientByUsername returns the first connected client with the given username or nil.
func (cr *ChatRoom) handleHistoryCommand(client *Client, args []string) {
	count := 20 // Default
	if len(args) > 1 {
		fmt.Sscanf(args[1], "%d", &count)
	}

	if count > 100 {
		count = 100 // Limit
	}

	cr.sendHistory(client, count)
}

func (cr *ChatRoom) findClientByUsername(username string) *Client {
	cr.roomsMu.Lock()
	defer cr.roomsMu.Unlock()
	for _, room := range cr.rooms {
		room.mu.Lock()
		for client := range room.clients {
			if client.username == username {
				room.mu.Unlock()
				return client
			}
		}
		room.mu.Unlock()
	}
	return nil
}

// ==

func (c *Client) markActive() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.lastActive = time.Now()
}

func (c *Client) isInactive(timeout time.Duration) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return time.Since(c.lastActive) > timeout
}
