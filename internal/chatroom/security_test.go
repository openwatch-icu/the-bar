package chatroom

import (
	"strings"
	"testing"
)

// TestCommandParsingOnlyFirstToken documents that the server only uses parts[0] for command
// dispatch, so payloads like "/commands ; echo INJECTION_TEST" do not execute shell or inject.
func TestCommandParsingOnlyFirstToken(t *testing.T) {
	// Server parses with strings.Fields; only parts[0] is the command. So "/commands ; echo X"
	// yields parts[0]=="/commands" and the rest is ignored — no exec/shell.
	parts := strings.Fields("/commands ; echo INJECTION_TEST")
	if len(parts) < 1 || parts[0] != "/commands" {
		t.Fatalf("parts[0] = %q, want /commands", parts[0])
	}
	// Path traversal: /join ../../etc/passwd → room name rejected by ValidateRoomName
	joinParts := strings.Fields("/join ../../etc/passwd")
	if len(joinParts) >= 2 && ValidateRoomName(joinParts[1]) {
		t.Errorf("path traversal room name should be rejected")
	}
}

func TestValidateRoomName(t *testing.T) {
	valid := []string{"general", "room1", "private:alice", "a", "room-with-dash"}
	for _, name := range valid {
		if !ValidateRoomName(name) {
			t.Errorf("ValidateRoomName(%q) = false, want true", name)
		}
	}
	invalid := []string{"", "..", "room/foo", "room\\bar", "a\nb", "a\rb", "../etc/passwd", "room/../other"}
	for _, name := range invalid {
		if ValidateRoomName(name) {
			t.Errorf("ValidateRoomName(%q) = true, want false", name)
		}
	}
}

func TestValidateUsername(t *testing.T) {
	valid := []string{"alice", "Bob", "user123"}
	for _, name := range valid {
		if !ValidateUsername(name) {
			t.Errorf("ValidateUsername(%q) = false, want true", name)
		}
	}
	invalid := []string{"", "..", "alice/bob", "a\\b", "a\nb", "../admin"}
	for _, name := range invalid {
		if ValidateUsername(name) {
			t.Errorf("ValidateUsername(%q) = true, want false", name)
		}
	}
}

func TestSanitizeForLog(t *testing.T) {
	// Control chars stripped
	if out := SanitizeForLog("hello\x00world"); out != "helloworld" {
		t.Errorf("SanitizeForLog(control) = %q", out)
	}
	if out := SanitizeForLog("a\nb"); out != "ab" {
		t.Errorf("SanitizeForLog(\\n) = %q", out)
	}
	// ANSI CSI sequence stripped
	ansi := "\x1b[2J\x1b[HINJECTION_TEST"
	if out := SanitizeForLog(ansi); strings.Contains(out, "\x1b") || !strings.Contains(out, "INJECTION_TEST") {
		t.Errorf("SanitizeForLog(ANSI) = %q (should strip ESC, keep text)", out)
	}
	// Normal text unchanged
	normal := "Hello, world!"
	if out := SanitizeForLog(normal); out != normal {
		t.Errorf("SanitizeForLog(normal) = %q", out)
	}
}
