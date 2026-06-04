# PostgreSQL Unix Socket Peer Authentication Research

Date: 2026-05-27

## Summary

Paperclip currently supports PostgreSQL through two runtime shapes:

- Embedded PostgreSQL when `DATABASE_URL` is unset.
- External PostgreSQL when a URL is supplied through `DATABASE_URL`, `.paperclip/.env`, or `config.database.connectionString`.

The NixOS module already provisions the right Unix user and PostgreSQL role shape for peer authentication: the service user and database role are both `paperclip`, and `ensureDBOwnership = true` is set for the NixOS-managed database. However, the module currently avoids peer authentication and instead builds a loopback TCP `DATABASE_URL` from `database.passwordFile`, then runs a password-setting oneshot before starting Paperclip.

Adding Unix socket peer authentication is feasible, but it should be treated as a small database connection-model change rather than a Nix-only string tweak. The shared database helpers, server startup, migrations, and backup code currently assume a connection string.

## Findings

PostgreSQL peer authentication only applies to local Unix-domain socket connections. In `pg_hba.conf`, `local` records match Unix sockets, and the `peer` method obtains the client operating-system user name and checks it against the requested database role. PostgreSQL docs: <https://www.postgresql.org/docs/current/auth-pg-hba-conf.html>

NixOS PostgreSQL defaults align with this. The NixOS manual says local connections use Unix sockets and support peer authentication, and that a system user can connect passwordlessly when its name matches the database role. NixOS manual: <https://nixos.org/manual/nixos/stable/#module-services-postgres>

The installed `postgres` npm package supports Unix sockets, but Paperclip does not expose that capability today. `postgres` accepts a socket path through options such as:

```ts
postgres({
  host: "/run/postgresql",
  port: 5432,
  database: "paperclip",
  username: "paperclip",
});
```

The existing URL-only approach is the blocker. The NixOS module comment currently says socket URLs were not usable, so it works around that by using TCP plus password. The better path is to pass structured connection options to `postgres()` rather than trying to encode Unix sockets in a URL.

## Current Implementation Constraints

- `packages/db/src/runtime-config.ts` resolves external PostgreSQL to a `connectionString` only.
- `packages/db/src/client.ts` exposes `createDb(url)` and utility/migration helpers that all accept URL strings.
- `server/src/index.ts` checks startup migrations and creates DB clients from string URLs.
- `packages/db/src/backup-lib.ts` passes `--dbname=<connectionString>` to `pg_dump` and uses string URLs for JavaScript backup/restore paths.
- The NixOS module requires `database.passwordFile` for `database.createLocally = true`, builds `/run/paperclip/db-env`, and runs `paperclip-postgres-password.service`.

## Implementation Implications

The clean implementation would introduce a shared database target type, for example:

```ts
type DatabaseTarget =
  | { kind: "url"; connectionString: string }
  | { kind: "socket"; socketDir: string; database: string; user: string; port?: number };
```

Then update the shared DB functions to accept that target:

- `createDb(target)`
- `inspectMigrations(target)`
- `applyPendingMigrations(target)`
- `getPostgresDataDirectory(target)`
- backup/restore helpers

For NixOS, add a peer-auth path for `database.createLocally = true`:

- Stop requiring `database.passwordFile` in peer mode.
- Do not build a TCP `DATABASE_URL`.
- Export socket-oriented runtime settings instead, such as `PAPERCLIP_DATABASE_SOCKET_DIR=/run/postgresql`, `PAPERCLIP_DATABASE_NAME=paperclip`, and `PAPERCLIP_DATABASE_USER=paperclip`.
- Remove or bypass `paperclip-postgres-password.service` in peer mode.
- Keep `services.postgresql.ensureDatabases` and `ensureUsers.ensureDBOwnership`.
- Keep external `database.url` unchanged for hosted and separately managed databases.

Backup/restore needs explicit handling because `pg_dump --dbname=<url>` is URL-centric. Socket mode should call tools with libpq-style arguments:

```sh
pg_dump --host=/run/postgresql --username=paperclip --dbname=paperclip ...
psql --host=/run/postgresql --username=paperclip --dbname=paperclip ...
```

## TDD Verification Outline

Use vertical slices rather than bulk tests.

1. Add a resolver test showing socket env/config resolves to a structured socket target.
2. Add a DB client test showing a socket target is translated into `postgres` options without requiring a password or URL.
3. Add a NixOS module eval test where `database.createLocally = true` works without `database.passwordFile` when peer auth is selected.
4. Add or update the NixOS VM test to verify migrations land in the NixOS-managed database through peer auth and do not silently fall back to embedded PostgreSQL.
5. Add a backup helper test that socket targets produce `pg_dump`/`psql` arguments with `--host`, `--username`, and `--dbname` instead of `--dbname=<url>`.

## Risks

- Partial conversion could make the server start but leave `pnpm db:migrate`, backups, or CLI doctor/config paths broken.
- Authenticated public deployment validation currently requires a Postgres URL; socket targets should remain local-only and should not satisfy public hosted deployment checks.
- Unix socket paths differ by platform and package. NixOS uses `/run/postgresql`; non-NixOS support would need either config or discovery.
- Socket peer auth depends on the Paperclip process running as the same OS user as the PostgreSQL role, or on a correct PostgreSQL user map.

## Recommendation

Start with NixOS-managed local PostgreSQL only. It already has the matching service user and database role, so it is the lowest-risk place to add peer auth. General non-NixOS socket support can come later after the shared database target abstraction exists and the backup/migration paths are proven.
