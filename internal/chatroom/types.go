package chatroom

import (
	"os"
	"sync"
	"time"
)

// E2EPrefix is the wire-format prefix for E2E-encrypted payloads. When a message
// starts with this prefix, the server stores and forwards it as an opaque blob
// (no plaintext parsing or body logging). E2E payload may be versioned; the server
// does not parse beyond the prefix. See https://the-b4r.netlify.app/wiki/e2e_and_tamper and https://the-b4r.netlify.app/wiki/e2e_protocol
const E2EPrefix = "e2e."

// Message represents a single chat message with metadata.
// When Content starts with E2EPrefix, it holds an opaque E2E blob; the server
// does not parse or log the body.
type Message struct {
	ID        int       `json:"id"`
	From      string    `json:"from"`
	Content   string    `json:"content"`
	Timestamp time.Time `json:"timestamp"`
	Channel   string    `json:"channel"` // "global" or "private:username"
}

// DefaultRoomName is the room new clients join by default.
const DefaultRoomName = "general"

// JoinChannelBufferSize is the buffer size for the join channel so connection
// goroutines don't block on Run() when many clients connect at once.
const JoinChannelBufferSize = 10000

// Client represents a connected user
type Client struct {
	conn         LineConn    // Line-based connection (TCP or WebSocket)
	username     string      // Display name
	outgoing     chan string // Buffered channel for writes
	lastActive   time.Time   // For idle detection
	messagesSent int         // Statistics
	messagesRecv int
	isSlowClient bool // Testing flag; only active when SLOW_CLIENT_TEST env is set

	reconnectToken string
	currentRoom    string     // Room name the client is in
	mu             sync.Mutex // Protects stats fields
	closeOnce      sync.Once  // Ensures outgoing is closed exactly once
}

// PrivateRoomPrefix is the prefix for room names that are private (hidden from /rooms list).
const PrivateRoomPrefix = "private:"

// Room is a named channel with its own clients and history (history filtered from ChatRoom.messages by Channel).
// IsPrivate is true for rooms whose name starts with PrivateRoomPrefix; they are excluded from /rooms.
type Room struct {
	name      string
	clients   map[*Client]bool
	mu        sync.Mutex
	IsPrivate bool
}

// JoinPayload is sent when a client joins a room.
type JoinPayload struct {
	Client   *Client
	RoomName string
}

// BroadcastPayload is sent when a client sends a chat message (delivered to their current room).
type BroadcastPayload struct {
	Client  *Client
	Message string
}

// ChatRoom is the central coordinator; it owns multiple rooms.
// InstanceSlug scopes sessions and username uniqueness to this instance.
type ChatRoom struct {
	InstanceSlug string // e.g. "private"; from INSTANCE_SLUG
	AccessCode   string // optional; if set, join requires " accesscode:XYZ" to match (env ACCESS_CODE)

	// Communication channels
	join          chan JoinPayload
	leave         chan *Client
	switchRoom    chan JoinPayload // switch room without disconnecting
	broadcast     chan BroadcastPayload
	listUsers     chan *Client
	directMessage chan DirectMessage

	// State: rooms by name
	rooms   map[string]*Room
	roomsMu sync.Mutex

	// Legacy global state (totalMessages, startTime) for /users stats
	mu            sync.Mutex
	totalMessages int
	startTime     time.Time

	// Message history (all rooms; Message.Channel holds room name)
	messages      []Message
	messageMu     sync.Mutex
	nextMessageID int

	// Persistence
	walFile *os.File
	walMu   sync.Mutex
	dataDir string

	// Sessions
	sessions   map[string]*SessionInfo
	sessionsMu sync.Mutex

	// Timeouts (inactivity disconnect, idle label, read deadline)
	Timeouts TimeoutConfig

	// Offline DM inbox: pending DMs per recipient username, delivered on next join
	dmInbox   map[string][]DirectMessageRecord
	dmInboxMu sync.Mutex

	// RetentionDays: delete message history older than this many days (0 = keep forever)
	RetentionDays int

	// BAR (Burn After Reading): set at launch, immutable
	BarUserAllowed    bool // if true, users can set their own BAR (capped by SessionBarMinutes and UserBarMaxMinutes)
	SessionBarMinutes int  // 0 = no BAR; otherwise max retention in minutes for any message
	UserBarMaxMinutes int  // when BarUserAllowed, cap user-set BAR at this many minutes (default 2880; hard cap 43200)
	// userBarMinutes: effective BAR in minutes per username, set at join when BarUserAllowed; protected by userBarMu
	userBarMinutes map[string]int
	userBarMu      sync.Mutex

	// Optional logging (from config): when false, do not log broadcast message body. Connection addresses are never logged (see redactedAddrConn).
	LogBroadcastBody bool
	// ReduceLogRate: when true, do not log each broadcast or "Skipped (channel full)" line; use [loadstats] for counts.
	ReduceLogRate bool

	// PersistMessages: when false, no WAL/snapshot (memory-only); when true, persist to disk.
	PersistMessages bool

	// MinimumAge: when > 0, join requires client to send age confirmation (" ageconfirmed" in join line). 0 = no restriction.
	MinimumAge int

	// SlowmodeSeconds: per-room cooldown in seconds between messages per user. 0 = disabled.
	SlowmodeSeconds int
	// RateLimitPerSec: max chat messages per second per user. 0 = disabled.
	RateLimitPerSec int
	// AllowJoinWithoutToken: when true, plain username (no reconnect) allowed if name not currently connected; session is replaced and new token issued.
	AllowJoinWithoutToken bool
	// lastRoomMessageAt: username -> roomName -> last message time (for slowmode)
	lastRoomMessageAt   map[string]map[string]time.Time
	lastRoomMessageAtMu sync.Mutex
	// rateLimitHits: username -> recent message timestamps (for per-user rate limit)
	rateLimitHits   map[string][]time.Time
	rateLimitHitsMu sync.Mutex
	// GlobalRateLimitPerSec: max chat messages per second across all users. 0 = disabled.
	GlobalRateLimitPerSec int
	globalRateLimitHits   []time.Time
	globalRateLimitHitsMu sync.Mutex

	// shutdownCh: closed by shutdown() to signal Run() to exit its event loop.
	shutdownCh chan struct{}

	// Wrapped room keys (opaque blobs): per-room E2E key material wrapped with access-code-derived key on client; server never sees plain key.
	wrappedRoomKeys   map[string]string
	wrappedRoomKeysMu sync.Mutex

	// Stats for load-test observability: conns, msgs in/out, skipped, snapshot/prune duration.
	stats   LoadStats
	statsMu sync.Mutex

	// MaxSessions: max sessions the server holds at once (0 = unlimited). New joins rejected at capacity.
	MaxSessions int
	// MaxMessages: max messages kept in memory/snapshot (0 = unlimited). Oldest messages trimmed on snapshot.
	MaxMessages int

	// ClientOutgoingBuffer: size of each client's outgoing channel (from config). 0 = use default 64.
	ClientOutgoingBuffer int
	// BroadcastWorkers: number of goroutines that consume from broadcast channel (from config).
	BroadcastWorkers int
	// broadcastWorkersWg: used at shutdown to wait for broadcast workers to drain before closing WAL.
	broadcastWorkersWg sync.WaitGroup

	// Async WAL: messages enqueued here are written in batches by the persistence goroutine.
	walPending        chan Message
	walBatchSize      int
	walSyncIntervalMs int
	walShutdownDone   chan struct{} // closed when WAL worker has finished draining
}

// LoadStats holds counters and last-run metrics for periodic logging (e.g. every 10s).
// Used to correlate snapshot/prune with latency and disconnects during stress tests.
type LoadStats struct {
	MsgsIn             uint64    // total chat messages received (handleBroadcast)
	MsgsOut            uint64    // total messages sent to clients (successful sends)
	SkippedChannelFull uint64    // times a send was dropped because client outgoing buffer was full
	SnapshotDurationMs int64     // last createSnapshot duration in ms
	SnapshotBytes      int64     // last snapshot size in bytes
	SnapshotAt         time.Time // when last snapshot completed
	PruneDurationMs    int64     // last prune duration in ms
	PruneType          string    // "retention" or "BAR"
	PruneAt            time.Time // when last prune completed
}

// SessionInfo tracks reconnection data.
// TokenHash is the hash of the reconnect token; plaintext is never stored.
// Optional password skeleton (Matrix-style): PasswordHash and RecoveryKeyHash are empty until user sets a password.
type SessionInfo struct {
	Username        string
	TokenHash       string
	LastSeen        time.Time
	CreatedAt       time.Time
	PasswordHash    string // optional; bcrypt hash of password, empty if not set
	RecoveryKeyHash string // optional; hash of one-time recovery key, shown once on signup
}

// DirectMessage represents a private message (used when recipient is online).
type DirectMessage struct {
	toClient *Client
	message  string
}

// DirectMessageRecord is a stored DM for offline delivery (sender, recipient, content, timestamp).
type DirectMessageRecord struct {
	From      string
	To        string
	Content   string
	Timestamp time.Time
}

// MaxPendingDMPerUser is the maximum number of pending DMs stored per recipient when offline.
const MaxPendingDMPerUser = 50

// Input limits to avoid unbounded memory and DoS.
const (
	MaxUsernameLen = 128
	MaxRoomNameLen = 128
	MaxMessageLen  = 16 * 1024  // 16 KiB per message body
	MaxLineLen     = 128 * 1024 // 128 KiB per line (e.g. join line, WebSocket frame)
)
