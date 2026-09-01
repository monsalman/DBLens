package main

import (
	"context"
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/dblens/dblens/internal/api"
	"github.com/dblens/dblens/internal/connection"
)

//go:embed all:dist
var embeddedFS embed.FS

func main() {
	port := flag.Int("port", 8080, "Port for DBLens server to listen on")
	dataDir := flag.String("data", "", "Directory to store configuration or data")
	staticDir := flag.String("static", "", "Custom path to static frontend dist files")
	flag.Parse()

	_ = dataDir

	var distFS fs.FS
	if sub, err := fs.Sub(embeddedFS, "dist"); err == nil {
		distFS = sub
	}

	authPass := os.Getenv("DBLENS_AUTH_PASSWORD")
	mgr := connection.NewManager()
	handler := api.NewHandler(mgr)
	router := api.SetupRouter(handler, api.RouterConfig{
		AuthPassword: authPass,
		StaticDir:    *staticDir,
		EmbedFS:      distFS,
	})

	addr := fmt.Sprintf(":%d", *port)
	server := &http.Server{
		Addr:         addr,
		Handler:      router,
		ReadTimeout:  60 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	go func() {
		log.Printf("DBLens server listening on http://localhost:%d\n", *port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed to start: %v\n", err)
		}
	}()

	<-stop
	log.Println("Shutting down DBLens server...")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Printf("Server shutdown error: %v\n", err)
	}

	log.Println("DBLens exited cleanly")
}
