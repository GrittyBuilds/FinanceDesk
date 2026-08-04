# Finance Desk — Sync Server

A tiny, **dependency-free** sync server so you can use Finance Desk across
multiple devices and share a household ledger with family. Built on Node's
built-in `http` and `crypto` modules with a JSON file for storage — no
`npm install`, no database to set up.

## Run it

```bash
node server/server.js
# or, from this folder:
npm start
```

Then open the app it serves at <http://localhost:4000>. The server hosts both
the app **and** the sync API on one origin, so there's nothing else to run.

### Configuration (environment variables)

| Variable    | Default            | Purpose |
|-------------|--------------------|---------|
| `PORT`      | `4000`             | Port to listen on |
| `FD_SECRET` | generated & stored | Secret for signing auth tokens. **Set this** to keep everyone logged in across restarts. |
| `FD_DB`     | `server/db.json`   | Where data is stored |
| `FD_STATIC` | repo root          | Folder the app is served from |

```bash
PORT=8080 FD_SECRET="a-long-random-string" node server/server.js
```

## How sync works

- **Accounts** — register with an email + password. Each user automatically gets
  a **Personal** workspace.
- **Workspaces** — a workspace holds one dataset (accounts, transactions,
  budgets). Create a **Shared** workspace for the family and invite others.
- **Invite codes** — a shared-workspace member generates a code; others join
  with it.
- **Push / Pull** — the whole dataset syncs with a version counter. If someone
  else pushed since you last synced, your push is rejected (409) and the app
  asks you to pull first. Simple and predictable for family use.

## API

| Method & path | Auth | Purpose |
|---------------|------|---------|
| `GET /api/health` | — | Status + counts |
| `POST /api/register` | — | `{email,password}` → `{token,user}` (creates Personal workspace) |
| `POST /api/login` | — | `{email,password}` → `{token,user}` |
| `GET /api/workspaces` | ✓ | List your workspaces + roles |
| `POST /api/workspaces` | ✓ | `{name}` → create a shared workspace |
| `POST /api/workspaces/:id/invite` | ✓ | → `{code}` (shared only) |
| `POST /api/workspaces/join` | ✓ | `{code}` → join a shared workspace |
| `GET /api/workspaces/:id/data` | ✓ | → `{version,data,updatedAt}` |
| `PUT /api/workspaces/:id/data` | ✓ | `{baseVersion,data}` → `{version}` or `409` |

Auth is a signed token (HMAC-SHA256) sent as `Authorization: Bearer <token>`.
Passwords are hashed with `scrypt`.

## Security notes

- Run behind HTTPS (a reverse proxy like Caddy or nginx) if exposing beyond your
  home network — tokens and data are sent in plaintext over HTTP otherwise.
- The server stores workspace data **unencrypted** in `db.json` (you control the
  box). The app's **PIN encryption protects data at rest on each device**, not
  the server copy.
- There's no rate limiting or email verification — it's built for a trusted
  household, not the public internet. Keep `db.json` backed up.
