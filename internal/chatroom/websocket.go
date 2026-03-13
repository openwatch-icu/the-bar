package chatroom

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

const defaultWSPingIntervalSec = 25

// wsLineConn wraps a gorilla WebSocket connection to implement LineConn.
// One text frame = one line.
type wsLineConn struct {
	conn          *websocket.Conn
	writeDeadline time.Duration // applied before every write; 0 uses the 30s default
}

// NewWSLineConn wraps a WebSocket connection as a LineConn with no write deadline.
// Prefer newWSLineConn (unexported) when a deadline is available.
func NewWSLineConn(conn *websocket.Conn) LineConn {
	return &wsLineConn{conn: conn}
}

// newWSLineConn wraps a WebSocket connection with a configurable write deadline.
func newWSLineConn(conn *websocket.Conn, writeDeadline time.Duration) LineConn {
	if writeDeadline <= 0 {
		writeDeadline = 30 * time.Second
	}
	return &wsLineConn{conn: conn, writeDeadline: writeDeadline}
}

func (c *wsLineConn) ReadLine() (string, error) {
	_, data, err := c.conn.ReadMessage()
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (c *wsLineConn) WriteLine(s string) error {
	deadline := c.writeDeadline
	if deadline <= 0 {
		deadline = 30 * time.Second
	}
	c.conn.SetWriteDeadline(time.Now().Add(deadline))
	return c.conn.WriteMessage(websocket.TextMessage, []byte(s))
}

func (c *wsLineConn) SetReadDeadline(t time.Time) {
	c.conn.SetReadDeadline(t)
}

func (c *wsLineConn) Close() error {
	return c.conn.Close()
}

// Ensure wsLineConn implements LineConn.
var _ LineConn = (*wsLineConn)(nil)

// NewHTTPServer returns an HTTP server configured for WebSocket and CORS.
// WebSocket is served at /{instanceSlug}/ws; only the configured slug is accepted (others get 404).
// The caller should start it with srv.ListenAndServe() and shut it down with srv.Shutdown(ctx) for graceful exit.
func NewHTTPServer(chatRoom *ChatRoom, addr string, allowedOrigins []string, instanceSlug string) *http.Server {
	upgrader := &websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			origin := r.Header.Get("Origin")
			// Empty Origin is allowed for non-browser clients (e.g. CLI, native apps); browser clients typically send Origin.
			if origin == "" {
				return true
			}
			for _, o := range allowedOrigins {
				if o == origin {
					return true
				}
			}
			return false
		},
	}

	mux := http.NewServeMux()
	// Root: identify server and instance slug (for debugging and health checks).
	// Keep this handler cheap (no chatRoom state) so load balancers can use it for health checks.
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{
			"app":           "the-bar",
			"instance_slug": instanceSlug,
			"session_info":  "/" + instanceSlug + "/session-info",
			"ws":            "/" + instanceSlug + "/ws",
		})
	})
	wsPath := "/" + instanceSlug + "/ws"
	mux.HandleFunc(wsPath, func(w http.ResponseWriter, r *http.Request) {
		handleWebSocket(w, r, chatRoom, upgrader)
	})
	sessionInfoPath := "/" + instanceSlug + "/session-info"
	mux.HandleFunc(sessionInfoPath, func(w http.ResponseWriter, r *http.Request) {
		handleSessionInfo(w, r, chatRoom)
	})

	handler := corsMiddleware(mux, allowedOrigins)
	return &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		ReadHeaderTimeout: 10 * time.Second,
		MaxHeaderBytes:    1 << 20, // 1 MiB
	}
}

// ServeHTTP starts the HTTP server for WebSocket and CORS and blocks until it fails.
// For graceful shutdown use NewHTTPServer instead and call Shutdown on the returned server.
func ServeHTTP(chatRoom *ChatRoom, addr string, allowedOrigins []string, instanceSlug string) error {
	return NewHTTPServer(chatRoom, addr, allowedOrigins, instanceSlug).ListenAndServe()
}

func corsMiddleware(next http.Handler, allowedOrigins []string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		// Session-info is public config; allow any origin so desktop (Tauri) and other clients can fetch it.
		if strings.HasSuffix(r.URL.Path, "/session-info") {
			if origin != "" {
				w.Header().Set("Access-Control-Allow-Origin", origin)
			} else {
				w.Header().Set("Access-Control-Allow-Origin", "*")
			}
		} else {
			for _, o := range allowedOrigins {
				if o == origin {
					w.Header().Set("Access-Control-Allow-Origin", origin)
					break
				}
			}
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func handleSessionInfo(w http.ResponseWriter, r *http.Request, chatRoom *ChatRoom) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"bar_user_allowed":     chatRoom.BarUserAllowed,
		"session_bar_minutes":  chatRoom.SessionBarMinutes,
		"user_bar_max_minutes": chatRoom.UserBarMaxMinutes,
		"instance_slug":        chatRoom.InstanceSlug,
		"log_broadcast_body":   chatRoom.LogBroadcastBody,
		"messages_persisted":   chatRoom.PersistMessages,
		"minimum_age":          chatRoom.MinimumAge,
	})
}

func handleWebSocket(w http.ResponseWriter, r *http.Request, chatRoom *ChatRoom, upgrader *websocket.Upgrader) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("WebSocket upgrade failed", "err", err)
		return
	}
	// Reject frames larger than MaxLineLen before allocating their payload.
	conn.SetReadLimit(MaxLineLen)

	// done is closed before conn.Close() (defers are LIFO) so the ping goroutine
	// exits promptly instead of waiting for the next ticker tick.
	done := make(chan struct{})
	defer conn.Close()
	defer close(done)

	// Keepalive: send Ping periodically so proxies/browsers don't close the connection as idle.
	pingInterval := defaultWSPingIntervalSec
	if v := os.Getenv("WS_PING_INTERVAL_SECONDS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			pingInterval = n
		}
	}
	go func() {
		ticker := time.NewTicker(time.Duration(pingInterval) * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				deadline := time.Now().Add(5 * time.Second)
				if err := conn.WriteControl(websocket.PingMessage, nil, deadline); err != nil {
					return
				}
			}
		}
	}()

	lineConn := newWSLineConn(conn, chatRoom.Timeouts.WriteDeadline)
	handleClient(lineConn, chatRoom)
}
