package chatroom

import (
	"fmt"
	"net"

	"github.com/eyedeekay/sam3"
)

// ListenI2P connects to the SAM bridge at samAddress, creates a stream session with the given
// sessionName, and starts listening for incoming I2P connections. It returns a net.Listener
// (use it with http.Server.Serve), the I2P destination address in base32 (e.g. for the address book),
// and an error. The caller must call listener.Close() when done.
func ListenI2P(samAddress, sessionName string) (net.Listener, string, error) {
	samConn, err := sam3.NewSAM(samAddress)
	if err != nil {
		return nil, "", fmt.Errorf("I2P SAM connection: %w", err)
	}
	keys, err := samConn.NewKeys()
	if err != nil {
		samConn.Close()
		return nil, "", fmt.Errorf("I2P NewKeys: %w", err)
	}
	stream, err := samConn.NewStreamSession(sessionName, keys, sam3.Options_Medium)
	if err != nil {
		samConn.Close()
		return nil, "", fmt.Errorf("I2P NewStreamSession: %w", err)
	}
	listener, err := stream.Listen()
	if err != nil {
		stream.Close()
		samConn.Close()
		return nil, "", fmt.Errorf("I2P Listen: %w", err)
	}
	b32 := stream.Addr().Base32()
	return listener, b32, nil
}
