# Kinopio Local Server Prototype

A loopback-only, standalone Node server for durable canonical Kinopio space documents. It uses Node 22's built-in `node:sqlite` (`DatabaseSync`); no extra runtime dependencies or Vite configurations are required.

```sh
KINOPIO_LOCAL_PORT=8081 \
KINOPIO_LOCAL_DB=./kinopio-local.sqlite \
KINOPIO_LOCAL_ASSETS=./kinopio-local.sqlite.assets \
node local-server/server.js
```

When environment variables are omitted, the server listens on `127.0.0.1:8081` and defaults to `./kinopio-local.sqlite` and `./kinopio-local.sqlite.assets` in the current working directory.

## HTTP API Reference

| Method | Path | Request Body | Response Body | Description |
| --- | --- | --- | --- | --- |
| `GET` | `/health` | — | `{ ok: true }` | Health check |
| `GET` | `/spaces` | — | `{ spaces: [...] }` | Returns list of all stored space documents |
| `POST` | `/spaces` | Complete space JSON document | `{ space: {...} }` | Creates and stores a new space |
| `GET` | `/spaces/:id` | — | `{ space: {...} }` | Returns complete document for space `:id` |
| `PUT` | `/assets/:id/:name` | Binary stream (≤ 16MB) | `{ url: "/assets/:id/:name" }` | Stores attachment with content type metadata |
| `GET` | `/assets/:id/:name` | — | Binary stream | Serves attachment with browser sandbox headers |
| `GET` | `/events` | — | `text/event-stream` | SSE stream announcing committed `{ operations, spaceIds }` |
| `POST` | `/operations` | `[{ name, body }, ...]` (≤ 10MB) | `{ operations, spaceIds }` | Applies operation batch in a single transaction |

## Storage & Transaction Semantics

- **Document Structure**: A complete space document contains `id`, `cards`, `boxes`, `connections`, `lines`, `lists`, `tags`, and `drawingStrokes`. Unknown document and entity fields round-trip without loss.
- **Batch Processing**: Operations in `POST /operations` are executed within a single SQLite transaction (`BEGIN IMMEDIATE ... COMMIT`). Failures trigger an immediate rollback.
- **Deduplication**: Operation IDs (`body.operationId`) are recorded in an `applied_operations` table. Duplicated operation IDs are ignored safely, ensuring idempotent retries across transport interruptions.
- **Deletion Scopes**:
  - `deleteAllRemovedCards`: Operates on the target space, purging cards marked with `isRemoved: true`.
  - `deleteAllRemovedSpaces`: Operates across the workspace database, permanently removing all spaces marked with `isRemoved: true`.
  - `deleteCard`: Permanently removes the target card.
- **Idempotent Card Updates**: An `updateCard` payload containing only `{ id }` (resulting from undefined snap-alignment coordinates omitted during JSON serialization) is treated as a no-op before entity lookup. Any update containing actual fields on a non-existent card returns a 404 error.
- **Authorship & Ownership**: Imported creator identifiers (`userId`) are preserved. Entity updates strip incoming `userId` to avoid overwriting the original creator, while tracking modification metadata (`nameUpdatedByUserId`, `nameUpdatedAt`).
- **Attachment Delivery**: File uploads stream through a 16MB length limit with atomic disk writes. Browser download responses send `Content-Security-Policy: sandbox` and `X-Content-Type-Options: nosniff` headers to isolate served files from the app origin.
- **Server-Sent Events**: The `/events` stream notifies connected clients of committed database changes. Transient mouse motion and active user presence are not handled.

## Test Suite

Run the standalone server test suite:

```sh
node --test local-server/test.mjs
```

## External CLI Tool

A command-line tool for inspecting and manipulating local spaces is maintained externally in the `kaoru-skills` repository under `skills/kinopio/tools/kinopio/kinopio.js` (an optional symlink `local-server/kinopio.js` may point to it). The CLI is optional and is not maintained as a standalone component in this repository.
