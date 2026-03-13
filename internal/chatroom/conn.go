package chatroom

import (
	"bufio"
	"net"
	"time"
)

// redactedAddr implements net.Addr with no identifiable address.
type redactedAddr struct{}

func (redactedAddr) Network() string { return "tcp" }
func (redactedAddr) String() string  { return "redacted" }

// redactedAddrConn wraps a net.Conn so RemoteAddr() never returns a real address.
// The server application never sees or logs connection IPs.
type redactedAddrConn struct {
	net.Conn
}

func (c *redactedAddrConn) RemoteAddr() net.Addr {
	return redactedAddr{}
}

// NewRedactedConn wraps conn so that RemoteAddr() returns a redacted address.
func NewRedactedConn(conn net.Conn) net.Conn {
	return &redactedAddrConn{Conn: conn}
}

// LineConn is the abstraction for line-based I/O used by the chat server.
// Both TCP and WebSocket connections implement this interface.
type LineConn interface {
	ReadLine() (string, error)
	WriteLine(string) error
	SetReadDeadline(time.Time)
	Close() error
}

// tcpLineConn wraps a net.Conn to implement LineConn using bufio.
type tcpLineConn struct {
	conn   net.Conn
	reader *bufio.Reader
	writer *bufio.Writer
}

// NewTCPLineConn wraps a net.Conn as a LineConn.
func NewTCPLineConn(conn net.Conn) LineConn {
	return &tcpLineConn{
		conn:   conn,
		reader: bufio.NewReader(conn),
		writer: bufio.NewWriter(conn),
	}
}

func (c *tcpLineConn) ReadLine() (string, error) {
	s, err := c.reader.ReadString('\n')
	if err != nil {
		return "", err
	}
	return s, nil
}

func (c *tcpLineConn) WriteLine(s string) error {
	_, err := c.writer.WriteString(s)
	if err != nil {
		return err
	}
	return c.writer.Flush()
}

func (c *tcpLineConn) SetReadDeadline(t time.Time) {
	c.conn.SetReadDeadline(t)
}

func (c *tcpLineConn) Close() error {
	return c.conn.Close()
}

// Ensure tcpLineConn implements LineConn at compile time.
var _ LineConn = (*tcpLineConn)(nil)
