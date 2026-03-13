package chatroom

import (
	"crypto/subtle"
	"fmt"
	"log/slog"
	"math/rand"
	"net"
	"os"
	"strconv"
	"strings"
	"time"
)

// enableSimulateCrash returns true if ENABLE_SIMULATE_CRASH=1 or true (for testing only).
func enableSimulateCrash() bool {
	v := strings.TrimSpace(strings.ToLower(os.Getenv("ENABLE_SIMULATE_CRASH")))
	return v == "1" || v == "true"
}

// enableResetSessions returns true if ENABLE_RESET_SESSIONS=1 or true (for testing only).
// When set, /reset-sessions command clears all sessions so new names can join.
func enableResetSessions() bool {
	v := strings.TrimSpace(strings.ToLower(os.Getenv("ENABLE_RESET_SESSIONS")))
	return v == "1" || v == "true"
}

// buildWelcomeMessage returns the welcome and command list sent to a client after join.
// Used by handleJoin so Welcome is sent via client.outgoing (writer already running).
func buildWelcomeMessage(username string) string {
	msg := fmt.Sprintf("Welcome, %s! (in #%s)\n", username, DefaultRoomName)
	msg += "Commands:\n"
	msg += "  /users - List users in current room\n"
	msg += "  /rooms - List all rooms (private rooms are hidden)\n"
	msg += "  /join <room> - Join or create a room (use private:name for secret rooms)\n"
	msg += "  /history [N] - Show last N messages in this room\n"
	msg += "  /msg <user> <msg> - Private message\n"
	msg += "  /token - Show your reconnect token\n"
	msg += "  /stats - Show your stats\n"
	msg += "  /commands - Show command list\n"
	if enableSimulateCrash() {
		msg += "  /simulate crash - Test crash handling\n"
	}
	if enableResetSessions() {
		msg += "  /reset-sessions - Clear all sessions (dev only; everyone must re-join)\n"
	}
	msg += "  /quit - Leave\n"
	return msg
}

// handleClient manages a single connection (TCP or WebSocket): prompt for username,
// register client, start writer goroutine and process incoming lines.
func handleClient(conn LineConn, chatRoom *ChatRoom) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("panic in handleClient", "recover", r)
		}
		conn.Close()
	}()

	// Set initial read timeout for username
	conn.SetReadDeadline(time.Now().Add(30 * time.Second))

	// Ask for username or reconnect token
	conn.WriteLine("Enter username (or 'reconnect:<username>:<token>' to reconnect): \n")

	input, err := conn.ReadLine()
	if err != nil {
		fmt.Println("Failed to read username:", err)
		return
	}
	input = strings.TrimSpace(input)
	if len(input) > MaxLineLen {
		conn.WriteLine("Input too long.\n")
		return
	}

	// Optional suffix " accesscode:XYZ" (e.g. from web client). Extract and strip for join validation.
	// Take only the first token after " accesscode:" so later suffixes (e.g. " ageconfirmed") remain in input.
	var accessCodeProvided string
	if idx := strings.Index(input, " accesscode:"); idx >= 0 {
		rest := input[idx+len(" accesscode:"):]
		if spaceIdx := strings.Index(rest, " "); spaceIdx >= 0 {
			accessCodeProvided = rest[:spaceIdx]
			input = strings.TrimSpace(input[:idx] + " " + strings.TrimSpace(rest[spaceIdx:]))
		} else {
			accessCodeProvided = strings.TrimSpace(rest)
			input = strings.TrimSpace(input[:idx])
		}
	}

	// Optional suffix " bar:N" (user BAR in minutes). Extract and strip when session allows user BAR.
	var userBarMinutes int
	if idx := strings.Index(input, " bar:"); idx >= 0 {
		suffix := strings.TrimSpace(input[idx+len(" bar:"):])
		input = strings.TrimSpace(input[:idx])
		if n, err := strconv.Atoi(suffix); err == nil && n >= 0 {
			userBarMinutes = n
		}
	}

	// Optional suffix " ageconfirmed" — required when server has MinimumAge > 0 (age-restricted).
	var ageConfirmed bool
	if idx := strings.Index(input, " ageconfirmed"); idx >= 0 {
		ageConfirmed = true
		input = strings.TrimSpace(input[:idx])
	}

	var username string
	var reconnectToken string
	var isReconnecting bool

	if strings.HasPrefix(input, "reconnect:") {
		parts := strings.Split(input, ":")
		if len(parts) == 3 {
			username = strings.TrimSpace(parts[1])
			reconnectToken = strings.TrimSpace(parts[2])
			isReconnecting = true
		} else {
			conn.WriteLine("Invalid reconnect format. Use: reconnect:<username>:<token> \n")
			return
		}
	} else {
		username = input
	}

	if username == "" {
		username = fmt.Sprintf("Guest%d", rand.Intn(1000))
	}
	if len(username) > MaxUsernameLen {
		username = username[:MaxUsernameLen]
	}
	if !ValidateUsername(username) {
		conn.WriteLine("Invalid username (no .., /, \\, or newlines).\n")
		return
	}

	// When server is age-restricted, require age confirmation in the join line (no check, no entry).
	if chatRoom.MinimumAge > 0 && !ageConfirmed {
		conn.WriteLine("Age confirmation required to join this server.\n")
		return
	}

	// Access code is mandatory: server must have ACCESS_CODE set, and client must provide a valid code.
	if chatRoom.AccessCode == "" {
		conn.WriteLine("Access code required to join this server. Contact the instance admin.\n")
		return
	}
	if len(accessCodeProvided) != len(chatRoom.AccessCode) ||
		subtle.ConstantTimeCompare([]byte(accessCodeProvided), []byte(chatRoom.AccessCode)) != 1 {
		conn.WriteLine("Invalid or missing access code.\n")
		return
	}

	if isReconnecting {
		if chatRoom.validateReconnectToken(username, reconnectToken) {
			slog.Info("user reconnected", "username", username)
			conn.WriteLine(fmt.Sprintf("Welcome back, %s!\n", username))
		} else {
			// Token invalid. If no session exists (e.g. server restarted), allow join and issue new token.
			key := chatRoom.instanceSessionKey(username)
			chatRoom.sessionsMu.Lock()
			existingSession := chatRoom.sessions[key]
			chatRoom.sessionsMu.Unlock()
			if existingSession != nil {
				conn.WriteLine("Invalid reconnect token or session expired. \n")
				return
			}
			_, plainTok := chatRoom.createSession(username)
			if plainTok == "" {
				conn.WriteLine("Server at capacity. Try again later.\n")
				return
			}
			reconnectToken = plainTok
			msg := "Your previous session was lost (e.g. server restart). New password token — save it to rejoin later:\n"
			msg += fmt.Sprintf("   reconnect:%s:%s\n", username, plainTok)
			conn.WriteLine(msg)
		}
	} else {
		// New connection - check if username is already connected in this instance
		if chatRoom.isUsernameConnected(username) {
			conn.WriteLine(fmt.Sprintf("Please choose an alternative username, %s is unavailable.\n", username))
			return
		}

		// check if session exists (was connected before)
		chatRoom.sessionsMu.Lock()
		existingSession := chatRoom.sessions[chatRoom.instanceSessionKey(username)]
		chatRoom.sessionsMu.Unlock()

		if existingSession != nil {
			if chatRoom.AllowJoinWithoutToken {
				// No one is currently connected with this name (we checked above). Replace session and issue new token.
				key := chatRoom.instanceSessionKey(username)
				chatRoom.sessionsMu.Lock()
				delete(chatRoom.sessions, key)
				chatRoom.sessionsMu.Unlock()
				_, plainTok := chatRoom.createSession(username)
				if plainTok == "" {
					conn.WriteLine("Server at capacity. Try again later.\n")
					return
				}
				reconnectToken = plainTok
				msg := "Your previous session was replaced. New reconnect token — save it to rejoin later:\n"
				msg += fmt.Sprintf("   reconnect:%s:%s\n", username, plainTok)
				conn.WriteLine(msg)
			} else {
				// They were here before; we don't store the plaintext token
				msg := "You already have a session. Use your saved reconnect token to reconnect.\n"
				msg += fmt.Sprintf("   Format: reconnect:%s:<your-token>\n", username)
				conn.WriteLine(msg)
				return
			}
		} else {
			// Brand new user, create session (returns plaintext token only once)
			_, plainTok := chatRoom.createSession(username)
			if plainTok == "" {
				conn.WriteLine("Server at capacity. Try again later.\n")
				return
			}
			reconnectToken = plainTok
			msg := fmt.Sprintf("Your reconnect token: %s\n", plainTok)
			msg += fmt.Sprintf("   Save this to reconnect: reconnect:%s:%s\n", username, plainTok)
			conn.WriteLine(msg)
		}
	}

	// Store user BAR when session allows (capped by UserBarMaxMinutes and optionally SessionBarMinutes)
	if chatRoom.BarUserAllowed && userBarMinutes > 0 {
		effective := userBarMinutes
		if effective > chatRoom.UserBarMaxMinutes {
			effective = chatRoom.UserBarMaxMinutes
		}
		if chatRoom.SessionBarMinutes > 0 && effective > chatRoom.SessionBarMinutes {
			effective = chatRoom.SessionBarMinutes
		}
		chatRoom.userBarMu.Lock()
		if chatRoom.userBarMinutes == nil {
			chatRoom.userBarMinutes = make(map[string]int)
		}
		chatRoom.userBarMinutes[username] = effective
		chatRoom.userBarMu.Unlock()
		slog.Info("stored BAR", "username", username, "minutes", effective)
	} else if chatRoom.SessionBarMinutes > 0 && !chatRoom.BarUserAllowed {
		// Session-only BAR: no per-user BAR, so log at join so deploy logs show BAR is in effect
		slog.Info("BAR enabled for session", "minutes", chatRoom.SessionBarMinutes, "username", username)
	}

	outgoingBuf := chatRoom.ClientOutgoingBuffer
	if outgoingBuf <= 0 {
		outgoingBuf = 64
	}
	// Create client (outgoing buffer from config to reduce skipped_channel_full under bursty load)
	client := &Client{
		conn:           conn,
		username:       username,
		outgoing:       make(chan string, outgoingBuf),
		lastActive:     time.Now(),
		reconnectToken: reconnectToken,
		// Slow-client simulation: only active when SLOW_CLIENT_TEST env is set (never in production).
		isSlowClient: os.Getenv("SLOW_CLIENT_TEST") != "" && rand.Float64() < 0.1,
	}

	if client.isSlowClient {
		slog.Warn("slow client test mode active", "username", username)
	}

	// Clear read deadline for normal operation
	conn.SetReadDeadline(time.Time{})

	// Start writer before sending to join so handleJoin can send Welcome via client.outgoing.
	go writeMessages(client)
	chatRoom.join <- JoinPayload{Client: client, RoomName: DefaultRoomName}
	readMessages(client, chatRoom)

	// Client disconnected - update session but don't delete
	chatRoom.updateSessionActivity(username)
	chatRoom.leave <- client
}

func readMessages(client *Client, chatRoom *ChatRoom) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("panic in readMessages", "username", client.username, "recover", r)
		}
	}()

	readDeadline := chatRoom.Timeouts.ReadDeadline
	for {
		if readDeadline > 0 {
			client.conn.SetReadDeadline(time.Now().Add(readDeadline))
		} else {
			client.conn.SetReadDeadline(time.Time{}) // no deadline
		}
		message, err := client.conn.ReadLine()
		if err != nil {
			if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
				slog.Info("client read timed out", "username", client.username)
			} else {
				slog.Info("client disconnected", "username", client.username, "err", err)
			}
			return
		}
		if len(message) > MaxLineLen {
			client.outgoing <- "Line too long.\n"
			continue
		}

		client.markActive()

		message = strings.TrimSpace(message)
		if message == "" {
			continue
		}

		// E2E key exchange: dmkey:targetUsername:base64PublicKey — forward to target only; not stored as chat.
		if strings.HasPrefix(message, "dmkey:") {
			handleDMKey(client, chatRoom, message)
			continue
		}

		// Wrapped room key: client submits opaque blob for a room (first joiner); server stores and never parses.
		if strings.HasPrefix(message, "wrappedroomkey:") {
			handleWrappedRoomKey(client, chatRoom, message)
			continue
		}

		client.mu.Lock()
		client.messagesRecv++
		client.mu.Unlock()

		// Process command
		if strings.HasPrefix(message, "/") {
			handleCommand(client, chatRoom, message)
			continue
		}

		// Broadcast message to current room
		if len(message) > MaxMessageLen {
			client.outgoing <- "Message too long.\n"
			continue
		}
		formatted := fmt.Sprintf("[%s]: %s\n", client.username, message)
		chatRoom.broadcast <- BroadcastPayload{Client: client, Message: formatted}
	}
}

const wrappedRoomKeyPrefix = "wrappedroomkey:"

// handleWrappedRoomKey stores an opaque room-key blob from the client (first joiner creates key, wraps with access-code-derived key, sends here). Server never parses or unwraps.
// Format: wrappedroomkey:roomname:base64blob (room name may contain ":", so we split on last ":").
func handleWrappedRoomKey(client *Client, chatRoom *ChatRoom, message string) {
	if len(message) <= len(wrappedRoomKeyPrefix) {
		return
	}
	rest := message[len(wrappedRoomKeyPrefix):]
	lastColon := strings.LastIndex(rest, ":")
	if lastColon <= 0 {
		return
	}
	roomName := strings.TrimSpace(strings.TrimPrefix(rest[:lastColon], "#"))
	blob := strings.TrimSpace(rest[lastColon+1:])
	if roomName == "" || blob == "" {
		return
	}
	if len(roomName) > MaxRoomNameLen {
		roomName = roomName[:MaxRoomNameLen]
	}
	if !ValidateRoomName(roomName) {
		return
	}
	chatRoom.wrappedRoomKeysMu.Lock()
	if chatRoom.wrappedRoomKeys == nil {
		chatRoom.wrappedRoomKeys = make(map[string]string)
	}
	chatRoom.wrappedRoomKeys[roomName] = blob
	chatRoom.wrappedRoomKeysMu.Unlock()

	// Deliver the wrapped key to all current room members so late joiners get the key.
	keyLine := fmt.Sprintf("wrappedroomkey:#%s:%s\n", roomName, blob)
	chatRoom.broadcastRoom(roomName, keyLine)
}

// getWrappedRoomKey returns the stored opaque blob for the room, or "" if none.
func (cr *ChatRoom) getWrappedRoomKey(roomName string) string {
	cr.wrappedRoomKeysMu.Lock()
	defer cr.wrappedRoomKeysMu.Unlock()
	return cr.wrappedRoomKeys[roomName]
}

// handleDMKey forwards E2E public-key exchange to the target user only.
// Format from client: dmkey:targetUsername:base64PublicKey
// Format sent to target: dmkey:senderUsername:base64PublicKey
// Server does not store or log the key; it is forwarded once.
func handleDMKey(client *Client, chatRoom *ChatRoom, message string) {
	parts := strings.SplitN(message, ":", 3)
	if len(parts) != 3 || parts[0] != "dmkey" || parts[1] == "" || parts[2] == "" {
		select {
		case client.outgoing <- "E2E key format: dmkey:<username>:<base64-public-key>\n":
		default:
		}
		return
	}
	targetUsername := strings.TrimSpace(parts[1])
	payload := parts[2]
	if targetUsername == client.username {
		return
	}
	target := chatRoom.findClientByUsername(targetUsername)
	if target == nil {
		select {
		case client.outgoing <- fmt.Sprintf("User %s not online; cannot send key.\n", targetUsername):
		default:
		}
		return
	}
	// Forward to target so they can store sender's public key
	line := fmt.Sprintf("dmkey:%s:%s\n", client.username, payload)
	select {
	case target.outgoing <- line:
	default:
		// Target's buffer full; drop key exchange (client can retry)
	}
}

// handleCommand parses and executes a simple client command. Returns true if
// the input was a command and was handled, false if it should be treated as
// a normal message.
// commandWhitelist is the exact set of command names the server accepts. No user input is passed to exec/shell.
var commandWhitelist = map[string]bool{
	"/heartbeat": true, "/commands": true, "/users": true, "/rooms": true,
	"/join": true, "/stats": true, "/simulate": true, "/msg": true,
	"/history": true, "/token": true, "/quit": true, "/reset-sessions": true,
	"/typing": true, "/typing-dm": true,
}

func handleCommand(client *Client, chatRoom *ChatRoom, command string) {
	parts := strings.Fields(command)
	if len(parts) == 0 {
		return
	}
	if !commandWhitelist[parts[0]] {
		select {
		case client.outgoing <- fmt.Sprintf("Unknown: %s\n", parts[0]):
		default:
		}
		return
	}

	switch parts[0] {
	case "/heartbeat":
		// No-op; client sends this to keep connection active. markActive() already called by caller.

	case "/commands":
		msg := "Commands:\n"
		msg += "  /users - List users in current room\n"
		msg += "  /rooms - List all rooms (private rooms hidden)\n"
		msg += "  /join <room> - Join or create a room (private:name for secret rooms)\n"
		msg += "  /history [N] - Show last N messages in this room\n"
		msg += "  /msg <user> <msg> - Private message\n"
		msg += "  /token - Show your reconnect token\n"
		msg += "  /stats - Show your stats\n"
		msg += "  /commands - Show this list\n"
		if enableResetSessions() {
			msg += "  /reset-sessions - Clear all sessions (dev only)\n"
		}
		msg += "  /quit - Leave\n"
		select {
		case client.outgoing <- msg:
		default:
		}

	case "/users":
		chatRoom.listUsers <- client

	case "/rooms":
		chatRoom.roomsMu.Lock()
		msg := "Rooms:\n"
		for name, room := range chatRoom.rooms {
			if room.IsPrivate {
				continue
			}
			room.mu.Lock()
			n := len(room.clients)
			room.mu.Unlock()
			msg += fmt.Sprintf("  #%s (%d)\n", name, n)
		}
		chatRoom.roomsMu.Unlock()
		select {
		case client.outgoing <- msg:
		default:
		}

	case "/join":
		if len(parts) < 2 {
			select {
			case client.outgoing <- "Usage: /join <room>\n":
			default:
			}
			return
		}
		roomName := strings.TrimPrefix(parts[1], "#")
		if roomName == "" {
			roomName = parts[1]
		}
		if len(roomName) > MaxRoomNameLen {
			roomName = roomName[:MaxRoomNameLen]
		}
		if !ValidateRoomName(roomName) {
			select {
			case client.outgoing <- "Invalid room name (no .., /, \\, or newlines).\n":
			default:
			}
			return
		}
		chatRoom.switchRoom <- JoinPayload{Client: client, RoomName: roomName}

	case "/stats":
		client.mu.Lock()
		stats := "Your Stats:\n"
		stats += fmt.Sprintf("  Messages sent: %d\n", client.messagesSent)
		stats += fmt.Sprintf("  Messages received: %d\n", client.messagesRecv)
		stats += fmt.Sprintf("  Last active: %s ago\n", time.Since(client.lastActive).Round(time.Second))
		if client.isSlowClient {
			stats += "  You are a SLOW CLIENT (test mode)\n"
		}
		client.mu.Unlock()

		select {
		case client.outgoing <- stats:
		default:
		}

	case "/simulate":
		if enableSimulateCrash() && len(parts) > 1 && parts[1] == "crash" {
			client.outgoing <- "Simulating crash...\n"
			time.Sleep(100 * time.Millisecond)
			client.conn.Close() // Abrupt disconnect!
			return
		}
		select {
		case client.outgoing <- fmt.Sprintf("Unknown: %s\n", parts[0]):
		default:
		}
		return

	case "/msg":
		if len(parts) < 3 {
			select {
			case client.outgoing <- "Usage: /msg <username> <message>\n":
			default:
			}
			return
		}

		targetUsername := parts[1]
		if !ValidateUsername(targetUsername) {
			select {
			case client.outgoing <- "Invalid username (no .., /, \\, or newlines).\n":
			default:
			}
			return
		}
		messageText := strings.Join(parts[2:], " ")
		if len(messageText) > MaxMessageLen {
			select {
			case client.outgoing <- "Message too long.\n":
			default:
			}
			return
		}

		if targetUsername == client.username {
			select {
			case client.outgoing <- "Can't message yourself!\n":
			default:
			}
			return
		}

		targetClient := chatRoom.findClientByUsername(targetUsername)
		if targetClient != nil {
			privateMsg := fmt.Sprintf("[From %s]: %s\n", client.username, messageText)
			select {
			case targetClient.outgoing <- privateMsg:
			default:
				select {
				case client.outgoing <- fmt.Sprintf("%s's inbox is full\n", targetUsername):
				default:
				}
				return
			}
			select {
			case client.outgoing <- fmt.Sprintf("Message sent to %s\n", targetUsername):
			default:
			}
			return
		}

		// Recipient offline: store for delivery when they join
		chatRoom.dmInboxMu.Lock()
		inbox := chatRoom.dmInbox[targetUsername]
		if inbox == nil {
			inbox = make([]DirectMessageRecord, 0, 1)
		}
		if len(inbox) >= MaxPendingDMPerUser {
			inbox = inbox[1:]
		}
		inbox = append(inbox, DirectMessageRecord{
			From:      client.username,
			To:        targetUsername,
			Content:   messageText,
			Timestamp: time.Now(),
		})
		chatRoom.dmInbox[targetUsername] = inbox
		chatRoom.dmInboxMu.Unlock()

		select {
		case client.outgoing <- fmt.Sprintf("Message stored; will be delivered when %s is online.\n", targetUsername):
		default:
		}

	case "/history":
		chatRoom.handleHistoryCommand(client, parts)

	case "/token":
		chatRoom.sessionsMu.Lock()
		session := chatRoom.sessions[chatRoom.instanceSessionKey(client.username)]
		chatRoom.sessionsMu.Unlock()

		if session != nil {
			msg := "You have a session. We don't store your token; use the one you saved when you first connected.\n"
			msg += fmt.Sprintf("   Format: reconnect:%s:<your-token>\n", client.username)
			select {
			case client.outgoing <- msg:
			default:
			}
		} else {
			select {
			case client.outgoing <- " No session found\n":
			default:
			}
		}

	case "/quit":
		select {
		case client.outgoing <- "Goodbye!\n":
		default:
		}
		time.Sleep(100 * time.Millisecond)
		client.conn.Close()

	case "/reset-sessions":
		if enableResetSessions() {
			chatRoom.ClearSessions()
			select {
			case client.outgoing <- "Sessions cleared. All users must re-join with a new name or new token.\n":
			default:
			}
		} else {
			select {
			case client.outgoing <- "Unknown: /reset-sessions\n":
			default:
			}
		}

	case "/typing":
		roomName := client.currentRoom
		if roomName == "" {
			roomName = DefaultRoomName
		}
		chatRoom.broadcastRoom(roomName, "[typing] "+client.username+"\n")

	case "/typing-dm":
		if len(parts) < 2 {
			return
		}
		targetUsername := parts[1]
		if !ValidateUsername(targetUsername) || targetUsername == client.username {
			return
		}
		targetClient := chatRoom.findClientByUsername(targetUsername)
		if targetClient != nil {
			select {
			case targetClient.outgoing <- "[typing-dm] " + client.username + "\n":
			default:
			}
		}

	default:
		select {
		case client.outgoing <- fmt.Sprintf("Unknown: %s\n", parts[0]):
		default:
		}
	}
}

// writeMessages forwards messages from client.outgoing to the connection.
func writeMessages(client *Client) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("panic in writeMessages", "username", client.username, "recover", r)
		}
	}()

	for message := range client.outgoing {
		// Simulate slow client
		if client.isSlowClient {
			time.Sleep(time.Duration(rand.Intn(500)) * time.Millisecond)
		}

		if err := client.conn.WriteLine(message); err != nil {
			slog.Error("write error", "username", client.username, "err", err)
			return
		}
	}
}
