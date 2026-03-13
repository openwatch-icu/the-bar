package chatroom

import (
	"os"
	"strconv"
	"strings"
	"time"
)

// TimeoutConfig holds configurable durations for inactivity and read deadlines.
type TimeoutConfig struct {
	InactivityDisconnect time.Duration // After this idle time, client is disconnected
	IdleLabel            time.Duration // After this idle time, user is shown as "(idle)" in /users
	ReadDeadline         time.Duration // Per-line read deadline after join
	WriteDeadline        time.Duration // Per-write deadline for WebSocket writes (0 = use 30s default)
	MaxSessionAge        time.Duration // Absolute max session lifetime regardless of activity (0 = no limit)
}

// ServerConfig holds all env-based configuration for the server (network, TLS, timeouts, retention, BAR).
// Load it once at startup via Load().
type ServerConfig struct {
	DataDir           string
	InstanceSlug      string
	AccessCode        string
	TCPAddr           string
	HTTPAddr          string
	AllowedOrigins    []string
	TLSHTTPEnable     bool
	TLSTCPEnable      bool
	TLSCertFile       string
	TLSKeyFile        string
	Timeouts          TimeoutConfig
	RetentionDays     int
	BarUserAllowed    bool // if true, users can set their own BAR (capped by SessionBarMinutes and UserBarMaxMinutes)
	SessionBarMinutes int  // 0 = no BAR; otherwise max retention in minutes for any message
	UserBarMaxMinutes int  // when BarUserAllowed, cap user-set BAR at this many minutes (default 2880 = 2 days; hard cap 43200 = 30 days)

	// Optional logging: when false, reduce what is written to stdout (for privacy-conscious deployments).
	LogBroadcastBody bool // if false, do not log message body in broadcast lines (log only room and client count)
	// ReduceLogRate: when true, do not log each "Broadcasting to..." or "Skipped ... (channel full)" line to avoid log flooding (e.g. Railway rate limits). [loadstats] still logs counts every 10s.
	ReduceLogRate bool

	// PersistMessages: when true (default), save message history to WAL and snapshots; when false, run in memory-only (no disk).
	PersistMessages bool

	// I2P: when true, also listen on I2P via SAM bridge (e.g. 127.0.0.1:7656). Requires an I2P router (i2pd or Java I2P) with SAM enabled.
	I2PEnable      bool
	I2PSAMAddress  string // default 127.0.0.1:7656
	I2PSessionName string // optional; default "thebar"

	// MinimumAge: when > 0, join requires client to send age confirmation (e.g. " ageconfirmed" in the join line). 0 = no age restriction. Default 18.
	MinimumAge int

	// SlowmodeSeconds: per-room cooldown in seconds between messages per user. 0 = disabled.
	SlowmodeSeconds int
	// RateLimitPerSec: max chat messages per second per user (or per connection). 0 = disabled.
	RateLimitPerSec int
	// GlobalRateLimitPerSec: max chat messages per second across all users. 0 = disabled.
	GlobalRateLimitPerSec int
	// AllowJoinWithoutToken: when true, if user sends plain username (no reconnect token) and no one is currently connected with that name, allow join and issue new token (replacing any existing session). Trade-off: name-squatting when owner is offline.
	AllowJoinWithoutToken bool
	// MaxSessions: max number of sessions the server will hold at once (0 = unlimited). Rejects new joins when at capacity.
	MaxSessions int
	// MaxMessages: max number of messages kept in memory and written to snapshot (0 = unlimited). Older messages are trimmed on snapshot.
	MaxMessages int

	// Scalability: channel buffer sizes and worker counts for high connection counts.
	BroadcastChannelBuffer     int // default 10000
	BroadcastWorkers           int // default 1, max 16
	LeaveChannelBuffer         int // default 1000
	SwitchRoomChannelBuffer    int // default 1000
	ListUsersChannelBuffer     int // default 1000
	DirectMessageChannelBuffer int // default 1000
	ClientOutgoingBuffer       int // default 256; per-connection outgoing queue size

	// WAL batching: async persistence for throughput.
	WALBatchSize      int // default 100; max messages per batch write
	WALSyncIntervalMs int // default 1000; max ms between Sync() calls
}

// MinAccessCodeLength is the minimum length for ACCESS_CODE. Shorter codes are rejected at startup for security.
const MinAccessCodeLength = 16

// Load reads all server configuration from the environment and returns a ServerConfig.
// If ACCESS_CODE is set but shorter than MinAccessCodeLength, Load panics (fail startup).
func Load() ServerConfig {
	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		dataDir = "./chatdata"
	}
	tcpAddr := os.Getenv("TCP_ADDR")
	if tcpAddr == "" {
		tcpAddr = ":9000"
	}
	httpAddr := os.Getenv("HTTP_ADDR")
	if httpAddr == "" {
		httpAddr = ":8080"
	}
	origins := os.Getenv("ALLOWED_ORIGINS")
	var allowedOrigins []string
	if origins != "" {
		for _, o := range strings.Split(origins, ",") {
			if s := strings.TrimSpace(o); s != "" {
				allowedOrigins = append(allowedOrigins, s)
			}
		}
	}
	if len(allowedOrigins) == 0 {
		allowedOrigins = []string{"http://localhost:5173", "tauri://localhost", "https://asset.localhost"}
	} else {
		// Always allow desktop app and local dev so ALLOWED_ORIGINS (e.g. production frontend) doesn't lock them out.
		extra := []string{"http://localhost:5173", "tauri://localhost", "https://asset.localhost"}
		seen := make(map[string]bool)
		for _, o := range allowedOrigins {
			seen[o] = true
		}
		for _, o := range extra {
			if !seen[o] {
				allowedOrigins = append(allowedOrigins, o)
			}
		}
	}
	tlsHTTPEnable := strings.TrimSpace(strings.ToLower(os.Getenv("TLS_HTTP_ENABLE"))) == "1" || strings.TrimSpace(strings.ToLower(os.Getenv("TLS_HTTP_ENABLE"))) == "true"
	tlsTCPEnable := strings.TrimSpace(strings.ToLower(os.Getenv("TLS_TCP_ENABLE"))) == "1" || strings.TrimSpace(strings.ToLower(os.Getenv("TLS_TCP_ENABLE"))) == "true"
	tlsCertFile := strings.TrimSpace(os.Getenv("TLS_CERT_FILE"))
	tlsKeyFile := strings.TrimSpace(os.Getenv("TLS_KEY_FILE"))
	instanceSlug := normalizeInstanceSlug(os.Getenv("INSTANCE_SLUG"))
	accessCode := strings.TrimSpace(os.Getenv("ACCESS_CODE"))
	if accessCode != "" && len(accessCode) < MinAccessCodeLength {
		panic("ACCESS_CODE must be at least 16 characters for security. Use a strong random code (e.g. openssl rand -base64 24).")
	}

	inact := 5
	if v := os.Getenv("INACTIVITY_DISCONNECT_MINUTES"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			inact = n
		}
	}
	idle := 1
	if v := os.Getenv("IDLE_LABEL_MINUTES"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			idle = n
		}
	}
	read := 5
	if v := os.Getenv("READ_DEADLINE_MINUTES"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			read = n
		}
	}
	writeDeadlineSec := 30
	if v := os.Getenv("WRITE_DEADLINE_SECONDS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			writeDeadlineSec = n
		}
	}
	// SESSION_MAX_AGE_HOURS: absolute session lifetime in hours regardless of activity (0 = no limit; default 24h).
	sessionMaxAgeHours := 24
	if v := os.Getenv("SESSION_MAX_AGE_HOURS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			sessionMaxAgeHours = n
		}
	}
	var sessionMaxAge time.Duration
	if sessionMaxAgeHours > 0 {
		sessionMaxAge = time.Duration(sessionMaxAgeHours) * time.Hour
	}
	timeouts := TimeoutConfig{
		InactivityDisconnect: time.Duration(inact) * time.Minute,
		IdleLabel:            time.Duration(idle) * time.Minute,
		ReadDeadline:         time.Duration(read) * time.Minute,
		WriteDeadline:        time.Duration(writeDeadlineSec) * time.Second,
		MaxSessionAge:        sessionMaxAge,
	}

	retentionDays := 0
	if v := os.Getenv("HISTORY_RETENTION_DAYS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			retentionDays = n
		}
	}

	barUserAllowed := false
	if v := os.Getenv("BAR_USER_ALLOWED"); v != "" {
		barUserAllowed = strings.TrimSpace(strings.ToLower(v)) == "1" || strings.TrimSpace(strings.ToLower(v)) == "true"
	}
	sessionBarMinutes := 0
	if v := os.Getenv("SESSION_BAR_MINUTES"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			sessionBarMinutes = n
		}
	}
	const userBarMaxDefault = 2880  // 2 days in minutes
	const userBarMaxHardCap = 43200 // 30 days in minutes
	userBarMaxMinutes := userBarMaxDefault
	if v := os.Getenv("USER_BAR_MAX_MINUTES"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			if n > userBarMaxHardCap {
				userBarMaxMinutes = userBarMaxHardCap
			} else {
				userBarMaxMinutes = n
			}
		}
	}

	logBroadcastBody := true
	if v := os.Getenv("LOG_BROADCAST_BODY"); v != "" {
		logBroadcastBody = strings.TrimSpace(strings.ToLower(v)) != "0" && strings.TrimSpace(strings.ToLower(v)) != "false"
	}
	reduceLogRate := strings.TrimSpace(strings.ToLower(os.Getenv("REDUCE_LOG_RATE"))) == "1" || strings.TrimSpace(strings.ToLower(os.Getenv("REDUCE_LOG_RATE"))) == "true"

	persistMessages := true
	if v := os.Getenv("PERSIST_MESSAGES"); v != "" {
		persistMessages = strings.TrimSpace(strings.ToLower(v)) != "0" && strings.TrimSpace(strings.ToLower(v)) != "false"
	}

	i2pEnable := false
	if v := os.Getenv("I2P_ENABLE"); v != "" {
		i2pEnable = strings.TrimSpace(strings.ToLower(v)) == "1" || strings.TrimSpace(strings.ToLower(v)) == "true"
	}
	i2pSAMAddress := strings.TrimSpace(os.Getenv("I2P_SAM_ADDRESS"))
	if i2pSAMAddress == "" {
		i2pSAMAddress = "127.0.0.1:7656"
	}
	i2pSessionName := strings.TrimSpace(os.Getenv("I2P_SESSION_NAME"))
	if i2pSessionName == "" {
		i2pSessionName = "thebar"
	}

	minimumAge := 18
	if v := os.Getenv("MINIMUM_AGE"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			minimumAge = n
		}
	}

	slowmodeSeconds := 0
	if v := os.Getenv("SLOWMODE_SECONDS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			slowmodeSeconds = n
		}
	}
	rateLimitPerSec := 0
	if v := os.Getenv("RATE_LIMIT_PER_SEC"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			rateLimitPerSec = n
		}
	}
	globalRateLimitPerSec := 0
	if v := os.Getenv("GLOBAL_RATE_LIMIT_PER_SEC"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			globalRateLimitPerSec = n
		}
	}
	allowJoinWithoutToken := strings.TrimSpace(strings.ToLower(os.Getenv("ALLOW_JOIN_WITHOUT_TOKEN"))) == "1" ||
		strings.TrimSpace(strings.ToLower(os.Getenv("ALLOW_JOIN_WITHOUT_TOKEN"))) == "true"

	// MAX_SESSIONS: cap on simultaneous sessions (0 = unlimited; default 10000).
	maxSessions := 10000
	if v := os.Getenv("MAX_SESSIONS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			maxSessions = n
		}
	}

	// MAX_MESSAGES: max messages kept in memory/snapshot (0 = unlimited).
	maxMessages := 0
	if v := os.Getenv("MAX_MESSAGES"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			maxMessages = n
		}
	}

	// Scalability: channel buffers and workers
	broadcastChannelBuffer := 10000
	if v := os.Getenv("BROADCAST_CHANNEL_BUFFER"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			broadcastChannelBuffer = n
		}
	}
	broadcastWorkers := 1
	if v := os.Getenv("BROADCAST_WORKERS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 16 {
			broadcastWorkers = n
		}
	}
	leaveChannelBuffer := 1000
	if v := os.Getenv("LEAVE_CHANNEL_BUFFER"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			leaveChannelBuffer = n
		}
	}
	switchRoomChannelBuffer := 1000
	if v := os.Getenv("SWITCH_ROOM_CHANNEL_BUFFER"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			switchRoomChannelBuffer = n
		}
	}
	listUsersChannelBuffer := 1000
	if v := os.Getenv("LIST_USERS_CHANNEL_BUFFER"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			listUsersChannelBuffer = n
		}
	}
	directMessageChannelBuffer := 1000
	if v := os.Getenv("DIRECT_MESSAGE_CHANNEL_BUFFER"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			directMessageChannelBuffer = n
		}
	}
	clientOutgoingBuffer := 256
	if v := os.Getenv("CLIENT_OUTGOING_BUFFER"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			if n > 1024 {
				clientOutgoingBuffer = 1024
			} else {
				clientOutgoingBuffer = n
			}
		}
	}
	walBatchSize := 100
	if v := os.Getenv("WAL_BATCH_SIZE"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			walBatchSize = n
		}
	}
	walSyncIntervalMs := 1000
	if v := os.Getenv("WAL_SYNC_INTERVAL_MS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			walSyncIntervalMs = n
		}
	}

	return ServerConfig{
		DataDir:                    dataDir,
		InstanceSlug:               instanceSlug,
		AccessCode:                 accessCode,
		TCPAddr:                    tcpAddr,
		HTTPAddr:                   httpAddr,
		AllowedOrigins:             allowedOrigins,
		TLSHTTPEnable:              tlsHTTPEnable,
		TLSTCPEnable:               tlsTCPEnable,
		TLSCertFile:                tlsCertFile,
		TLSKeyFile:                 tlsKeyFile,
		Timeouts:                   timeouts,
		RetentionDays:              retentionDays,
		BarUserAllowed:             barUserAllowed,
		SessionBarMinutes:          sessionBarMinutes,
		UserBarMaxMinutes:          userBarMaxMinutes,
		LogBroadcastBody:           logBroadcastBody,
		ReduceLogRate:              reduceLogRate,
		PersistMessages:            persistMessages,
		I2PEnable:                  i2pEnable,
		I2PSAMAddress:              i2pSAMAddress,
		I2PSessionName:             i2pSessionName,
		MinimumAge:                 minimumAge,
		SlowmodeSeconds:            slowmodeSeconds,
		RateLimitPerSec:            rateLimitPerSec,
		GlobalRateLimitPerSec:      globalRateLimitPerSec,
		AllowJoinWithoutToken:      allowJoinWithoutToken,
		MaxSessions:                maxSessions,
		MaxMessages:                maxMessages,
		BroadcastChannelBuffer:     broadcastChannelBuffer,
		BroadcastWorkers:           broadcastWorkers,
		LeaveChannelBuffer:         leaveChannelBuffer,
		SwitchRoomChannelBuffer:    switchRoomChannelBuffer,
		ListUsersChannelBuffer:     listUsersChannelBuffer,
		DirectMessageChannelBuffer: directMessageChannelBuffer,
		ClientOutgoingBuffer:       clientOutgoingBuffer,
		WALBatchSize:               walBatchSize,
		WALSyncIntervalMs:          walSyncIntervalMs,
	}
}

// normalizeInstanceSlug returns a URL-safe slug: lowercase, spaces to hyphens, only [a-z0-9-].
// Empty input returns "default".
func normalizeInstanceSlug(s string) string {
	s = strings.TrimSpace(strings.ToLower(s))
	if s == "" {
		return "default"
	}
	var b strings.Builder
	for _, r := range s {
		if r == ' ' {
			b.WriteRune('-')
		} else if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
			b.WriteRune(r)
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		return "default"
	}
	return out
}

// RetentionDays returns the number of days to retain message history (0 = keep forever).
// Prefer using Load().RetentionDays so all config is in one place.
func RetentionDays() int {
	v := os.Getenv("HISTORY_RETENTION_DAYS")
	if v == "" {
		return 0
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 0 {
		return 0
	}
	return n
}

// loadTimeoutConfig reads timeout settings from environment.
// Prefer using Load().Timeouts so all config is in one place.
func loadTimeoutConfig() TimeoutConfig {
	cfg := Load()
	return cfg.Timeouts
}
