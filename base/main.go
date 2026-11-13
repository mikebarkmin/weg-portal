package main

import (
	"log"
	"os"
	"path/filepath"

	"ganigeorgiev.com/pocketbase/pocketbase/plugins/migratecmd"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/osutils"

	"weg-portal"
)

// Version is set at build time (-ldflags "-X main.Version=v1.2.3") by the
// Dockerfile and the release workflow; "dev" for local builds.
var Version = "dev"

func main() {
	app := portal.New()
	app.RootCmd.Version = Version

	// ---------------------------------------------------------------
	// Optional flags:
	// ---------------------------------------------------------------

	var migrationsDir string
	if osutils.IsProbablyGoRun() {
		// pb_data lives in the repository root for "go run ./base",
		// so the Go migrations are its sibling directory
		migrationsDir = filepath.Join(app.DataDir(), "../migrations")
	}
	app.RootCmd.PersistentFlags().StringVar(
		&migrationsDir,
		"migrationsDir",
		migrationsDir,
		"the directory with the user defined migrations (default to pb_data/../pb_migrations)",
	)

	if err := app.RootCmd.ParseFlags(os.Args[1:]); err != nil {
		log.Fatal(err)
	}

	// ---------------------------------------------------------------
	// Plugins:
	// ---------------------------------------------------------------

	// migrate command
	// (use Go templates with "go run", otherwise JS)
	migrateConfig := migratecmd.Config{Dir: migrationsDir}
	if !osutils.IsProbablyGoRun() {
		migrateConfig.TemplateLang = migratecmd.TemplateLangJS
	}
	migratecmd.MustRegister(app, app.RootCmd, migrateConfig)

	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}
