package chatroom

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"log/slog"
	"math/rand"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func NewChatRoom(dataDir, instanceSlug, accessCode string) (*ChatRoom, error) {
	cfg := Load()
	broadcastBuf := cfg.BroadcastChannelBuffer
	if broadcastBuf <= 0 {
		broadcastBuf = 10000
	}
	leaveBuf := cfg.LeaveChannelBuffer
	if leaveBuf < 0 {
		leaveBuf = 0
	}
	switchBuf := cfg.SwitchRoomChannelBuffer
	if switchBuf < 0 {
		switchBuf = 0
	}
	listBuf := cfg.ListUsersChannelBuffer
	if listBuf < 0 {
		listBuf = 0
	}
	dmBuf := cfg.DirectMessageChannelBuffer
	if dmBuf < 0 {
		dmBuf = 0
	}
	cr := &ChatRoom{
		InstanceSlug:          instanceSlug,
		AccessCode:            accessCode,
		rooms:                 make(map[string]*Room),
		join:                  make(chan JoinPayload, JoinChannelBufferSize),
		leave:                 make(chan *Client, leaveBuf),
		switchRoom:            make(chan JoinPayload, switchBuf),
		broadcast:             make(chan BroadcastPayload, broadcastBuf),
		listUsers:             make(chan *Client, listBuf),
		directMessage:         make(chan DirectMessage, dmBuf),
		sessions:              make(map[string]*SessionInfo),
		messages:              make([]Message, 0),
		startTime:             time.Now(),
		dataDir:               dataDir,
		Timeouts:              cfg.Timeouts,
		dmInbox:               make(map[string][]DirectMessageRecord),
		RetentionDays:         cfg.RetentionDays,
		BarUserAllowed:        cfg.BarUserAllowed,
		SessionBarMinutes:     cfg.SessionBarMinutes,
		UserBarMaxMinutes:     cfg.UserBarMaxMinutes,
		userBarMinutes:        make(map[string]int),
		LogBroadcastBody:      cfg.LogBroadcastBody,
		ReduceLogRate:         cfg.ReduceLogRate,
		PersistMessages:       cfg.PersistMessages,
		MinimumAge:            cfg.MinimumAge,
		SlowmodeSeconds:       cfg.SlowmodeSeconds,
		RateLimitPerSec:       cfg.RateLimitPerSec,
		AllowJoinWithoutToken: cfg.AllowJoinWithoutToken,
		lastRoomMessageAt:     make(map[string]map[string]time.Time),
		rateLimitHits:         make(map[string][]time.Time),
		wrappedRoomKeys:       make(map[string]string),
		ClientOutgoingBuffer:  cfg.ClientOutgoingBuffer,
		BroadcastWorkers:      cfg.BroadcastWorkers,
		walBatchSize:          cfg.WALBatchSize,
		walSyncIntervalMs:     cfg.WALSyncIntervalMs,
		GlobalRateLimitPerSec: cfg.GlobalRateLimitPerSec,
		MaxSessions:           cfg.MaxSessions,
		MaxMessages:           cfg.MaxMessages,
		shutdownCh:            make(chan struct{}),
	}
	if cr.ClientOutgoingBuffer <= 0 {
		cr.ClientOutgoingBuffer = 256
	}
	if cr.BroadcastWorkers <= 0 {
		cr.BroadcastWorkers = 1
	}
	if cr.PersistMessages {
		cr.walPending = make(chan Message, 10000)
		cr.walShutdownDone = make(chan struct{})
	}

	if cfg.PersistMessages {
		if err := cr.loadSnapshot(); err != nil {
			slog.Error("failed to load snapshot", "err", err)
		}
		if err := cr.initializePersistence(); err != nil {
			return nil, err
		}
	}

	// Ensure default room exists (createRoom is safe to call)
	cr.getOrCreateRoom(DefaultRoomName)

	go cr.periodicSnapshots()
	if cr.SessionBarMinutes > 0 || cr.BarUserAllowed {
		go cr.periodicBARPrune()
	}
	go cr.periodicStatsLog()
	return cr, nil
}

func (cr *ChatRoom) periodicSnapshots() {
	// Jitter: random 0–60s delay before first run so snapshot doesn't align across restarts
	time.Sleep(time.Duration(rand.Intn(61)) * time.Second)
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		if cr.RetentionDays > 0 {
			if err := cr.pruneMessagesByRetention(); err != nil {
				slog.Error("prune/snapshot failed", "err", err)
			}
		}
		if !cr.PersistMessages {
			continue
		}
		cr.messageMu.Lock()
		messageCount := len(cr.messages)
		cr.messageMu.Unlock()
		if messageCount > 100 {
			if err := cr.createSnapshot(); err != nil {
				slog.Error("snapshot failed", "err", err)
			}
		}
	}
}

// periodicBARPrune runs every 2 minutes and prunes messages by per-sender BAR.
// Started only when SessionBarMinutes > 0.
func (cr *ChatRoom) periodicBARPrune() {
	// Jitter: random 0–60s delay so prune doesn't align with snapshot or other restarts
	time.Sleep(time.Duration(rand.Intn(61)) * time.Second)
	ticker := time.NewTicker(2 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		if err := cr.pruneMessagesByBAR(); err != nil {
			slog.Error("BAR prune failed", "err", err)
		}
	}
}

// addStatsMsgIn records one message received (handleBroadcast).
func (cr *ChatRoom) addStatsMsgIn() {
	cr.statsMu.Lock()
	cr.stats.MsgsIn++
	cr.statsMu.Unlock()
}

// addStatsMsgOut records one message successfully sent to a client.
func (cr *ChatRoom) addStatsMsgOut() {
	cr.statsMu.Lock()
	cr.stats.MsgsOut++
	cr.statsMu.Unlock()
}

// addStatsSkipped records one send dropped (client outgoing buffer full).
func (cr *ChatRoom) addStatsSkipped() {
	cr.statsMu.Lock()
	cr.stats.SkippedChannelFull++
	cr.statsMu.Unlock()
}

// recordSnapshot records snapshot duration and size for stats logging.
func (cr *ChatRoom) recordSnapshot(durationMs int64, bytes int64) {
	cr.statsMu.Lock()
	cr.stats.SnapshotDurationMs = durationMs
	cr.stats.SnapshotBytes = bytes
	cr.stats.SnapshotAt = time.Now()
	cr.statsMu.Unlock()
}

// recordPrune records prune duration and type for stats logging.
func (cr *ChatRoom) recordPrune(durationMs int64, pruneType string) {
	cr.statsMu.Lock()
	cr.stats.PruneDurationMs = durationMs
	cr.stats.PruneType = pruneType
	cr.stats.PruneAt = time.Now()
	cr.statsMu.Unlock()
}

// periodicStatsLog logs a single structured stats line every 10s for load-test observability.
// join_queue_pending helps debug join latency under load (high value = Run() falling behind).
func (cr *ChatRoom) periodicStatsLog() {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		cr.roomsMu.Lock()
		conns := 0
		for _, room := range cr.rooms {
			conns += len(room.clients)
		}
		cr.roomsMu.Unlock()
		joinPending := len(cr.join)
		cr.statsMu.Lock()
		s := cr.stats
		cr.statsMu.Unlock()
		slog.Info("loadstats",
			"conns_current", conns,
			"join_queue_pending", joinPending,
			"msgs_in", s.MsgsIn,
			"msgs_out", s.MsgsOut,
			"skipped_channel_full", s.SkippedChannelFull,
			"snapshot_duration_ms", s.SnapshotDurationMs,
			"snapshot_bytes", s.SnapshotBytes,
			"snapshot_at", s.SnapshotAt.Format(time.RFC3339),
			"prune_duration_ms", s.PruneDurationMs,
			"prune_type", s.PruneType,
			"prune_at", s.PruneAt.Format(time.RFC3339),
		)
	}
}

func (cr *ChatRoom) Run() {
	slog.Info("ChatRoom started")
	go cr.cleanupInactiveClients()
	go cr.pruneExpiredSessions()

	// Optional join worker pool: process joins in parallel to reduce latency under connection spikes.
	// JOIN_WORKERS env (default 1); set to 4–8 for high-traffic instances.
	joinWorkers := 1
	if v := os.Getenv("JOIN_WORKERS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 64 {
			joinWorkers = n
		}
	}
	for i := 0; i < joinWorkers; i++ {
		go func() {
			for payload := range cr.join {
				cr.handleJoin(payload)
			}
		}()
	}

	// Broadcast workers: consume from single buffered channel for throughput.
	cr.broadcastWorkersWg.Add(cr.BroadcastWorkers)
	for i := 0; i < cr.BroadcastWorkers; i++ {
		go func() {
			defer cr.broadcastWorkersWg.Done()
			for payload := range cr.broadcast {
				cr.handleBroadcast(payload)
			}
		}()
	}

	for {
		select {
		case client := <-cr.leave:
			cr.handleLeave(client)
		case payload := <-cr.switchRoom:
			cr.handleSwitchRoom(payload)
		case client := <-cr.listUsers:
			cr.sendUserList(client)
		case dm := <-cr.directMessage:
			cr.handleDirectMessage(dm)
		case <-cr.shutdownCh:
			return
		}
	}
}

// validateLicenseAtStartup checks the license with the license server if configured.
// Set DISABLE_LICENSE_CHECK=1 to skip (e.g. for dev). Otherwise LICENSE_KEY (or LICENSE_KEY_FILE) and LICENSE_SERVER_URL must be set.
func validateLicenseAtStartup() error {
	if strings.TrimSpace(strings.ToLower(os.Getenv("DISABLE_LICENSE_CHECK"))) == "1" ||
		strings.TrimSpace(strings.ToLower(os.Getenv("DISABLE_LICENSE_CHECK"))) == "true" {
		return nil
	}
	serverURL := strings.TrimSuffix(strings.TrimSpace(os.Getenv("LICENSE_SERVER_URL")), "/")
	key := strings.TrimSpace(os.Getenv("LICENSE_KEY"))
	if key == "" {
		if path := strings.TrimSpace(os.Getenv("LICENSE_KEY_FILE")); path != "" {
			b, err := os.ReadFile(path)
			if err != nil {
				return fmt.Errorf("reading LICENSE_KEY_FILE: %w", err)
			}
			key = strings.TrimSpace(string(b))
		}
	}
	if serverURL == "" || key == "" {
		return nil // not configured: allow startup (operator may not use licensing yet)
	}
	body, err := json.Marshal(map[string]string{"key": key})
	if err != nil {
		return fmt.Errorf("marshal license request: %w", err)
	}
	req, err := http.NewRequest(http.MethodPost, serverURL+"/validate", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("building request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("license server request: %w", err)
	}
	defer resp.Body.Close()
	var result struct {
		Valid bool `json:"valid"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return fmt.Errorf("license response invalid: %w", err)
	}
	if !result.Valid {
		return fmt.Errorf("license invalid or expired")
	}
	return nil
}

// NewChatRoomFromConfig creates a ChatRoom from a consolidated ServerConfig (e.g. from Load()).
func NewChatRoomFromConfig(cfg ServerConfig) (*ChatRoom, error) {
	broadcastBuf := cfg.BroadcastChannelBuffer
	if broadcastBuf <= 0 {
		broadcastBuf = 10000
	}
	leaveBuf := cfg.LeaveChannelBuffer
	if leaveBuf < 0 {
		leaveBuf = 0
	}
	switchBuf := cfg.SwitchRoomChannelBuffer
	if switchBuf < 0 {
		switchBuf = 0
	}
	listBuf := cfg.ListUsersChannelBuffer
	if listBuf < 0 {
		listBuf = 0
	}
	dmBuf := cfg.DirectMessageChannelBuffer
	if dmBuf < 0 {
		dmBuf = 0
	}
	cr := &ChatRoom{
		InstanceSlug:          cfg.InstanceSlug,
		AccessCode:            cfg.AccessCode,
		rooms:                 make(map[string]*Room),
		join:                  make(chan JoinPayload, JoinChannelBufferSize),
		leave:                 make(chan *Client, leaveBuf),
		switchRoom:            make(chan JoinPayload, switchBuf),
		broadcast:             make(chan BroadcastPayload, broadcastBuf),
		listUsers:             make(chan *Client, listBuf),
		directMessage:         make(chan DirectMessage, dmBuf),
		sessions:              make(map[string]*SessionInfo),
		messages:              make([]Message, 0),
		startTime:             time.Now(),
		dataDir:               cfg.DataDir,
		Timeouts:              cfg.Timeouts,
		dmInbox:               make(map[string][]DirectMessageRecord),
		RetentionDays:         cfg.RetentionDays,
		BarUserAllowed:        cfg.BarUserAllowed,
		SessionBarMinutes:     cfg.SessionBarMinutes,
		UserBarMaxMinutes:     cfg.UserBarMaxMinutes,
		userBarMinutes:        make(map[string]int),
		LogBroadcastBody:      cfg.LogBroadcastBody,
		ReduceLogRate:         cfg.ReduceLogRate,
		PersistMessages:       cfg.PersistMessages,
		MinimumAge:            cfg.MinimumAge,
		SlowmodeSeconds:       cfg.SlowmodeSeconds,
		RateLimitPerSec:       cfg.RateLimitPerSec,
		AllowJoinWithoutToken: cfg.AllowJoinWithoutToken,
		lastRoomMessageAt:     make(map[string]map[string]time.Time),
		rateLimitHits:         make(map[string][]time.Time),
		wrappedRoomKeys:       make(map[string]string),
		ClientOutgoingBuffer:  cfg.ClientOutgoingBuffer,
		BroadcastWorkers:      cfg.BroadcastWorkers,
		walBatchSize:          cfg.WALBatchSize,
		walSyncIntervalMs:     cfg.WALSyncIntervalMs,
		GlobalRateLimitPerSec: cfg.GlobalRateLimitPerSec,
		MaxSessions:           cfg.MaxSessions,
		MaxMessages:           cfg.MaxMessages,
		shutdownCh:            make(chan struct{}),
	}
	if cr.ClientOutgoingBuffer <= 0 {
		cr.ClientOutgoingBuffer = 256
	}
	if cr.BroadcastWorkers <= 0 {
		cr.BroadcastWorkers = 1
	}
	if cr.PersistMessages {
		cr.walPending = make(chan Message, 10000)
		cr.walShutdownDone = make(chan struct{})
	}
	if cfg.PersistMessages {
		if err := cr.loadSnapshot(); err != nil {
			slog.Error("failed to load snapshot", "err", err)
		}
		if err := cr.initializePersistence(); err != nil {
			return nil, err
		}
	}
	cr.getOrCreateRoom(DefaultRoomName)
	go cr.periodicSnapshots()
	if cr.SessionBarMinutes > 0 || cr.BarUserAllowed {
		go cr.periodicBARPrune()
	}
	return cr, nil
}

func runServer() {
	cfg := Load()

	if err := validateLicenseAtStartup(); err != nil {
		slog.Error("license check failed", "err", err)
		os.Exit(1)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigChan
		slog.Info("received shutdown signal")
		cancel()
	}()

	chatRoom, err := NewChatRoomFromConfig(cfg)
	if err != nil {
		slog.Error("failed to initialize server", "err", err)
		return
	}
	defer chatRoom.shutdown()
	go chatRoom.Run()

	var listener net.Listener
	if cfg.TLSTCPEnable && cfg.TLSCertFile != "" && cfg.TLSKeyFile != "" {
		cert, err := tls.LoadX509KeyPair(cfg.TLSCertFile, cfg.TLSKeyFile)
		if err != nil {
			slog.Error("failed to load TCP TLS cert/key", "err", err)
			return
		}
		tlsCfg := &tls.Config{Certificates: []tls.Certificate{cert}}
		listener, err = tls.Listen("tcp", cfg.TCPAddr, tlsCfg)
		if err != nil {
			slog.Error("error starting TLS TCP server", "err", err)
			return
		}
	} else {
		var err error
		listener, err = net.Listen("tcp", cfg.TCPAddr)
		if err != nil {
			slog.Error("error starting TCP server", "err", err)
			return
		}
	}
	defer listener.Close()

	httpSrv := NewHTTPServer(chatRoom, cfg.HTTPAddr, cfg.AllowedOrigins, cfg.InstanceSlug)
	useTLS := cfg.TLSHTTPEnable && cfg.TLSCertFile != "" && cfg.TLSKeyFile != ""
	if cfg.TLSHTTPEnable && (cfg.TLSCertFile == "" || cfg.TLSKeyFile == "") {
		slog.Warn("TLS_HTTP_ENABLE=1 but TLS_CERT_FILE or TLS_KEY_FILE missing; falling back to HTTP")
	}
	go func() {
		var err error
		if useTLS {
			err = httpSrv.ListenAndServeTLS(cfg.TLSCertFile, cfg.TLSKeyFile)
		} else {
			err = httpSrv.ListenAndServe()
		}
		if err != nil && err != http.ErrServerClosed {
			slog.Error("HTTP server error", "err", err)
		}
	}()
	defer func() {
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer shutdownCancel()
		if err := httpSrv.Shutdown(shutdownCtx); err != nil {
			slog.Error("HTTP shutdown error", "err", err)
		}
	}()

	scheme := "HTTP"
	if useTLS {
		scheme = "HTTPS"
	}
	slog.Info("server started", "tcp_addr", cfg.TCPAddr, "http_addr", cfg.HTTPAddr, "scheme", scheme)

	var i2pListener net.Listener
	if cfg.I2PEnable && cfg.I2PSAMAddress != "" {
		l, b32, err := ListenI2P(cfg.I2PSAMAddress, cfg.I2PSessionName)
		if err != nil {
			slog.Warn("I2P listener failed; continuing without I2P", "err", err)
		} else {
			i2pListener = l
			slog.Info("I2P server listening", "address", b32+".b32.i2p")
			httpSrvI2P := NewHTTPServer(chatRoom, "", cfg.AllowedOrigins, cfg.InstanceSlug)
			go func() {
				if err := httpSrvI2P.Serve(i2pListener); err != nil && err != http.ErrServerClosed {
					slog.Error("I2P HTTP server error", "err", err)
				}
			}()
			defer func() {
				shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
				defer shutdownCancel()
				if err := httpSrvI2P.Shutdown(shutdownCtx); err != nil {
					slog.Error("I2P HTTP shutdown error", "err", err)
				}
				i2pListener.Close()
			}()
		}
	}

	go func() {
		<-ctx.Done()
		listener.Close()
		// I2P listener is closed by the defer above (httpSrvI2P shutdown + i2pListener.Close())
		if i2pListener != nil {
			i2pListener.Close()
		}
	}()

	for {
		conn, err := listener.Accept()
		if err != nil {
			if ctx.Err() != nil {
				break
			}
			slog.Error("error accepting connection", "err", err)
			continue
		}
		go handleClient(NewTCPLineConn(NewRedactedConn(conn)), chatRoom)
	}
}

func (cr *ChatRoom) shutdown() {
	slog.Info("shutting down")
	// Signal Run() event loop to exit so no new leave/switchRoom/etc. are processed after shutdown.
	if cr.shutdownCh != nil {
		close(cr.shutdownCh)
	}
	// Stop broadcast workers first so no handleBroadcast runs after we close WAL.
	close(cr.broadcast)
	cr.broadcastWorkersWg.Wait()
	if cr.walPending != nil {
		close(cr.walPending)
		<-cr.walShutdownDone
	}
	if cr.PersistMessages {
		if err := cr.createSnapshot(); err != nil {
			slog.Error("final snapshot failed", "err", err)
		}
	}
	if cr.walFile != nil {
		cr.walFile.Close()
	}
	slog.Info("shutdown complete")
}

// runServer is the internal entry point used by StartServer in server.go.
