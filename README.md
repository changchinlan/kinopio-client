# kinopio-client (local server fork)

Kinopio is a spatial thinking canvas for organizing ideas, notes, and visual documents.

This repository is a fork of `kinopio-client` providing local canvas persistence, local attachment handling, and durable offline-friendly operation dispatch through a standalone loopback API server.

## Architecture

The local mode isolates spatial canvas data while retaining the upstream web interface:

- **Browser UI (`http://127.0.0.1:8082`)**:
  - Activated with `VITE_LOCAL_SERVER=true`.
  - Canvas operations append to a durable, client-side `localQueue` in IndexedDB.
  - User interface preferences, local notifications, and visited space lists remain in IndexedDB.
  - Proxies `/local-api` paths to `http://127.0.0.1:8081`.
  - Some upstream cloud UI and requests remain, including community feeds, changelog, and date imagery. Their API endpoints are not implemented locally and can return 404; they are not required for canvas persistence.
- **Standalone Local API Server (`http://127.0.0.1:8081`)**:
  - Implemented using Node 22 native `node:sqlite` (`DatabaseSync`).
  - Processes operation batches transactionally and deduplicates applied operation IDs.
  - Serves uploaded attachments directly from the local disk with browser response sandbox headers.
  - Defaults to `./kinopio-local.sqlite` and `./kinopio-local.sqlite.assets` in the working directory; wrapper scripts can override these to XDG data directories (`$XDG_DATA_HOME/kinopio`).

### Technical Characteristics

- **Local Canvas Persistence**: Spaces, cards, connections, boxes, lists, lines, tags, and drawing strokes persist in SQLite.
- **Queue Separation & Idempotency**: Canvas mutations queue in browser storage under `localQueue` (isolated from upstream cloud queues) and post to `POST /operations`. The server records `operationId` in the `applied_operations` table to prevent duplicate application during network retries.
- **Committed Event Stream (SSE)**: The `/events` endpoint delivers committed operation batches to connected clients. Transient mouse dragging coordinates and live user presence indicators are not broadcast.
- **Permissions & Authorship**: Local mode provides open editing across all items on the canvas without sign-in. Original author identifiers (`userId`) are preserved during document import; edit metadata (`nameUpdatedByUserId`, `nameUpdatedAt`) is updated upon modifications.
- **Upload & Request Limits**: The client UI enforces a 5MB threshold for standard uploads (`consts.freeUploadSizeLimit`). The local backend server enforces a 16MB stream limit per attachment and a 10MB limit per JSON operation batch. Attachments are served with `Content-Security-Policy: sandbox` and `X-Content-Type-Options: nosniff` headers.

## Getting Started

### Prerequisites

- Node.js 22.23+ (tested with 22.23.2, including native `node:sqlite` support)
- npm (using repository `package-lock.json`)

### Installation

```bash
npm ci
```

### Running

#### Option A: Using Nix Wrapper Scripts

The repository includes executable scripts configured with Nix shebangs. The API wrapper stores data in `${XDG_DATA_HOME:-$HOME/.local/share}/kinopio/`; `KINOPIO_LOCAL_DB`, `KINOPIO_LOCAL_ASSETS`, and `KINOPIO_LOCAL_PORT` override its defaults:

```bash
# Terminal 1: Start API server on 127.0.0.1:8081
./run-local-api

# Terminal 2: Start UI dev server on 127.0.0.1:8082
./run-local-ui
```

#### Option B: Using Portable Node Commands

```bash
# Terminal 1: Start API server (defaults to port 8081)
node local-server/server.js

# Terminal 2: Start UI server (port 8082 with local proxy)
VITE_LOCAL_SERVER=true VITE_PROD_SERVER=true npm run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:8082/app` in the browser to access the local canvas.

### Importing Spaces

To import a complete Kinopio JSON space document into the local database:

```bash
curl --fail-with-body -H 'Content-Type: application/json' \
  --data-binary @space-export.json \
  http://127.0.0.1:8081/spaces
```

## Running Tests

- **Unit tests (targeted Vitest suite)**:
  ```bash
  npx vitest run tests/unit/
  ```
- **Local server integration tests (Node native test runner)**:
  ```bash
  node --test local-server/test.mjs
  ```

## License

This project is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE.md).
