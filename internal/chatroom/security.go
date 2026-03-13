package chatroom

import (
	"strings"
	"unicode/utf8"
)

// Dangerous characters in room names or usernames (defense in depth: no path traversal or injection).
const (
	pathSep    = "/"
	pathSepWin = "\\"
	doubleDot  = ".."
)

// ValidateRoomName returns true if the room name is safe (no .., path separators, or newlines).
func ValidateRoomName(name string) bool {
	if name == "" {
		return false
	}
	if strings.Contains(name, doubleDot) || strings.Contains(name, pathSep) || strings.Contains(name, pathSepWin) {
		return false
	}
	for _, r := range name {
		if r == '\n' || r == '\r' {
			return false
		}
	}
	return true
}

// ValidateUsername returns true if the username is safe (no .., path separators, or newlines).
func ValidateUsername(name string) bool {
	if name == "" {
		return false
	}
	if strings.Contains(name, doubleDot) || strings.Contains(name, pathSep) || strings.Contains(name, pathSepWin) {
		return false
	}
	for _, r := range name {
		if r == '\n' || r == '\r' {
			return false
		}
	}
	return true
}

// SanitizeForLog strips control characters and ANSI escape sequences from s so that
// logging user-controlled content to stdout/terminal cannot manipulate the terminal.
func SanitizeForLog(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	i := 0
	for i < len(s) {
		r, size := utf8.DecodeRuneInString(s[i:])
		if size == 0 {
			i++
			continue
		}
		// Strip C0 control chars (0x00-0x1f), DEL (0x7f), and C1 (0x80-0x9f) when in log context
		if r < 0x20 || r == 0x7f || (r >= 0x80 && r < 0xa0) {
			i += size
			continue
		}
		// Strip ANSI escape sequences: ESC [ ... (until letter or ~)
		if r == '\x1b' && i+size < len(s) {
			start := i + size
			next, n := utf8.DecodeRuneInString(s[start:])
			if n > 0 && next == '[' {
				j := start + n
				for j < len(s) {
					rr, nn := utf8.DecodeRuneInString(s[j:])
					if nn == 0 {
						j++
						break
					}
					j += nn
					// CSI sequence ends with letter or ~
					if (rr >= 0x40 && rr <= 0x7e) || rr == '~' {
						i = j
						goto next
					}
				}
				i = j
				goto next
			}
		}
		b.WriteString(s[i : i+size])
		i += size
	next:
	}
	return b.String()
}
