package main

import (
	"bufio"
	"errors"
	"fmt"
	"log"
	"net/mail"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/plugins/migratecmd"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/osutils"

	"weg-portal"
	"weg-portal/hooks"
)

// Version is set at build time (-ldflags "-X main.Version=v1.2.3") by the
// release workflow and "make build"; "dev" for other local builds.
var Version = "dev"

func main() {
	app := portal.New()
	app.RootCmd.Version = Version
	hooks.Version = Version // shown in the SPA footer (GET /api/portal/config)

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

	app.RootCmd.AddCommand(superuserStdinCommand(app))

	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}

// superuserStdinCommand is "superuser upsert" with the password read from
// stdin (first line) instead of the argument list, which every local user
// can read in the process table (used by deploy/weg-portal-ctl superuser).
func superuserStdinCommand(app core.App) *cobra.Command {
	return &cobra.Command{
		Use:          "superuser-stdin <email>",
		Short:        "Creates, or updates if email exists, a superuser; the password is read from stdin",
		Args:         cobra.ExactArgs(1),
		SilenceUsage: true,
		RunE: func(command *cobra.Command, args []string) error {
			email := strings.TrimSpace(args[0])
			if addr, err := mail.ParseAddress(email); err != nil || addr.Address != email {
				return errors.New("missing or invalid email address")
			}

			line, err := bufio.NewReader(os.Stdin).ReadString('\n')
			if err != nil && line == "" {
				return errors.New("missing password on stdin")
			}
			password := strings.TrimRight(line, "\r\n")
			if password == "" {
				return errors.New("missing password on stdin")
			}

			superusers, err := app.FindCachedCollectionByNameOrId(core.CollectionNameSuperusers)
			if err != nil {
				return fmt.Errorf("failed to fetch %q collection: %w", core.CollectionNameSuperusers, err)
			}

			superuser, err := app.FindAuthRecordByEmail(superusers, email)
			if err != nil {
				superuser = core.NewRecord(superusers)
			}
			superuser.SetEmail(email)
			superuser.SetPassword(password)

			if err := app.Save(superuser); err != nil {
				return fmt.Errorf("failed to upsert superuser account: %w", err)
			}

			fmt.Printf("Saved superuser %q.\n", superuser.Email())
			return nil
		},
	}
}
