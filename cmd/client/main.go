package main

import (
	"fmt"

	"github.com/Curious-Keeper/the-bar/internal/chatroom"
)

func main() {
	fmt.Println("Starting client from cmd/client...")
	chatroom.StartClient()
}
