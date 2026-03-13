package main

import (
	"fmt"
	"os"

	"github.com/Curious-Keeper/the-bar/internal/chatroom"
)

func main() {
	fmt.Println("Starting server from cmd/server...")
	chatroom.StartServer()
	os.Exit(0)
}
