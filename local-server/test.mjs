import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SpaceStore } from './state.js'
import { createLocalServer } from './server.js'

const directory = await mkdtemp(join(tmpdir(), 'kinopio-local-server-'))
const app = createLocalServer({ databasePath: join(directory, 'spaces.sqlite') })
after(() => app.close())

const space = () => ({
  id: 'space-1', name: 'Original', userId: 'owner', cards: [], boxes: [], connections: [], lines: [], lists: [], tags: [], drawingStrokes: [],
  unknownFutureField: { keep: true }
})
let operationNumber = 0
const op = (name, body) => ({ name, body: { operationId: `op-${name}-${++operationNumber}`, userId: 'transport-user', clientCreatedAt: '2026-01-01T00:00:00.000Z', ...body } })

test('replaying a lost successful response deduplicates operation IDs', () => {
  app.store.create({ ...space(), id: 'space-dedupe' })
  const operation = op('updateSpace', { id: 'space-dedupe', spaceId: 'space-dedupe', name: 'Committed once' })
  app.store.applyBatch([operation])
  app.store.applyBatch([operation])
  assert.equal(app.store.get('space-dedupe').name, 'Committed once')
})

test('full documents survive creation and every canvas collection operation', () => {
  app.store.create(space())
  app.store.applyBatch([
    op('createCard', { id: 'card', spaceId: 'space-1', userId: 'card-owner', name: 'Card' }),
    op('createBox', { id: 'box', spaceId: 'space-1', userId: 'box-owner', name: 'Box' }),
    op('createList', { id: 'list', spaceId: 'space-1', userId: 'list-owner', name: 'List' }),
    op('createLine', { id: 'line', spaceId: 'space-1', userId: 'line-owner', name: 'Line' }),
    op('createConnection', { id: 'connection', spaceId: 'space-1', userId: 'connection-owner', startItemId: 'card', endItemId: 'box' }),
    op('createDrawingStroke', { spaceId: 'space-1', stroke: [{ id: 'stroke', x: 1, y: 2, color: '#000', diameter: 2 }] }),
    op('updateTags', { spaceId: 'space-1', tags: [{ id: 'tag', cardId: 'card', name: 'work', color: '#f00', userId: 'tag-owner' }] })
  ])
  app.store.applyBatch([
    op('updateCard', { id: 'card', spaceId: 'space-1', name: 'Renamed' }),
    op('updateBox', { id: 'box', spaceId: 'space-1', fill: 'empty' }),
    op('updateList', { id: 'list', spaceId: 'space-1', name: 'Renamed list', isCollapsed: true }),
    op('updateLine', { id: 'line', spaceId: 'space-1', y: 44 }),
    op('updateConnection', { id: 'connection', spaceId: 'space-1', color: '#fff' }),
    op('updateTagColorByName', { spaceId: 'space-1', tag: { name: 'work', color: '#0f0' } }),
    op('updateSpace', { id: 'space-1', spaceId: 'space-1', name: 'Changed' })
  ])
  let saved = app.store.get('space-1')
  assert.equal(saved.unknownFutureField.keep, true)
  assert.equal(saved.userId, 'owner')
  assert.equal(saved.cards[0].userId, 'card-owner')
  assert.equal(saved.cards[0].name, 'Renamed')
  assert.equal(saved.boxes[0].fill, 'empty')
  assert.equal(saved.lists[0].name, 'Renamed list')
  assert.equal(saved.lists[0].isCollapsed, true)
  assert.equal(saved.lines[0].y, 44)
  assert.equal(saved.connections[0].color, '#fff')
  assert.equal(saved.tags[0].color, '#0f0')
  assert.equal(saved.drawingStrokes[0][0].id, 'stroke')

  app.store.applyBatch([op('updateCard', { id: 'card', spaceId: 'space-1', isRemoved: true }), op('restoreRemovedCard', { id: 'card', spaceId: 'space-1', userId: 'card-owner', name: 'Restored' }), op('removeDrawingStroke', { spaceId: 'space-1', stroke: [{ id: 'stroke' }] }), op('removeTag', { id: 'tag', spaceId: 'space-1' })])
  saved = app.store.get('space-1')
  assert.equal(saved.cards[0].isRemoved, false)
  assert.equal(saved.cards[0].name, 'Renamed')
  assert.deepEqual(saved.drawingStrokes, [])
  assert.deepEqual(saved.tags, [])

  app.store.applyBatch([op('removeConnection', { id: 'connection', spaceId: 'space-1' }), op('removeBox', { id: 'box', spaceId: 'space-1' }), op('removeList', { id: 'list', spaceId: 'space-1' }), op('removeLine', { id: 'line', spaceId: 'space-1' }), op('deleteCard', { id: 'card', spaceId: 'space-1' })])
  saved = app.store.get('space-1')
  assert.deepEqual([saved.cards, saved.boxes, saved.connections, saved.lines, saved.lists].map(items => items.length), [0, 0, 0, 0, 0])
})

test('restore only clears a stored removed card and validation rolls back malformed mutations', () => {
  app.store.create({ ...space(), id: 'space-restore', cards: [{ id: 'card', name: 'Current', userId: 'owner', custom: { preserved: true } }] })
  app.store.applyBatch([op('restoreRemovedCard', { id: 'card', spaceId: 'space-restore', name: 'Stale active body', custom: { preserved: false } })])
  let saved = app.store.get('space-restore').cards[0]
  assert.equal(saved.name, 'Current')
  assert.equal(saved.custom.preserved, true)

  app.store.applyBatch([op('updateCard', { id: 'card', spaceId: 'space-restore', isRemoved: true }), op('restoreRemovedCard', { id: 'card', spaceId: 'space-restore', name: 'Stale removed body', custom: { preserved: false } })])
  saved = app.store.get('space-restore').cards[0]
  assert.equal(saved.isRemoved, false)
  assert.equal(saved.name, 'Current')
  assert.equal(saved.custom.preserved, true)

  assert.throws(() => app.store.applyBatch([op('updateSpace', { id: 'space-restore', spaceId: 'space-restore', cards: null })]), /space missing cards array/)
  assert.throws(() => app.store.applyBatch([op('createDrawingStroke', { spaceId: 'space-restore', stroke: [{ id: 'stroke', x: Infinity, y: 0, color: '#000', diameter: 2 }] })]), /finite x and y/)
  assert.throws(() => app.store.applyBatch([op('createDrawingStroke', { spaceId: 'space-restore', stroke: [{ id: 'one', x: 0, y: 0, color: '#000', diameter: 2 }, { id: 'two', x: 1, y: 1, color: '#000', diameter: 2 }] })]), /same id/)
  assert.throws(() => app.store.applyBatch([op('updateTags', { spaceId: 'space-restore', tags: [null] })]), /tag must be an object/)
  assert.deepEqual(app.store.get('space-restore').cards, [{ id: 'card', name: 'Current', userId: 'owner', custom: { preserved: true }, isRemoved: false }])
})

test('batches roll back completely and reject unknown operations', () => {
  assert.throws(() => app.store.applyBatch([op('createCard', { id: 'rolled-back', spaceId: 'space-1', userId: 'owner' }), op('notSupported', { spaceId: 'space-1' })]), /unsupported operation/)
  assert.equal(app.store.get('space-1').cards.find(card => card.id === 'rolled-back'), undefined)
})

test('queued full-space creation preserves the document but drops queue routing metadata', () => {
  const document = { ...space(), id: 'space-operation', spaceId: 'space-operation' }
  app.store.applyBatch([op('createSpace', document)])
  const saved = app.store.get('space-operation')
  assert.equal(saved.unknownFutureField.keep, true)
  assert.equal(Object.hasOwn(saved, 'spaceId'), false)
})

test('space operations target their explicit id, and delete-all sees the batch working set', () => {
  app.store.create({ ...space(), id: 'space-current' })
  app.store.create({ ...space(), id: 'space-update' })
  app.store.create({ ...space(), id: 'space-remove' })
  app.store.create({ ...space(), id: 'space-delete' })
  app.store.create({ ...space(), id: 'space-already-removed', isRemoved: true })

  app.store.applyBatch([
    op('updateSpace', { id: 'space-update', spaceId: 'space-current', name: 'Updated elsewhere' }),
    op('removeSpace', { id: 'space-remove', spaceId: 'space-current' }),
    op('deleteSpace', { id: 'space-delete', spaceId: 'space-current' }),
    op('removeSpace', { id: 'space-current', spaceId: 'space-current' }),
    op('deleteAllRemovedSpaces', { spaceId: 'space-current' })
  ])

  assert.equal(app.store.get('space-update').name, 'Updated elsewhere')
  assert.equal(app.store.get('space-delete'), undefined)
  assert.equal(app.store.get('space-remove'), undefined)
  assert.equal(app.store.get('space-already-removed'), undefined)
  assert.equal(app.store.get('space-current'), undefined)
})

test('only observed entity operation names are accepted', () => {
  app.store.create({ ...space(), id: 'space-allowlist' })
  assert.throws(() => app.store.applyBatch([
    op('createCard', { id: 'still-rolled-back', spaceId: 'space-allowlist', userId: 'card-owner' }),
    op('restoreRemovedBox', { id: 'invented', spaceId: 'space-allowlist' })
  ]), /unsupported operation restoreRemovedBox/)
  assert.throws(() => app.store.applyBatch([op('deleteLine', { id: 'invented', spaceId: 'space-allowlist' })]), /unsupported operation deleteLine/)
  assert.equal(app.store.get('space-allowlist').cards.length, 0)
})

test('subscriber failures are reported after commit, never as write failures', () => {
  app.store.create({ ...space(), id: 'space-subscriber' })
  const reported = []
  const originalError = console.error
  console.error = (...args) => reported.push(args)
  let notifications = 0
  const unsubscribe = app.store.subscribe(() => {
    notifications++
    throw new Error('transport is down')
  })
  try {
    assert.doesNotThrow(() => app.store.applyBatch([op('updateSpace', { id: 'space-subscriber', spaceId: 'space-subscriber', name: 'Committed' })]))
    assert.throws(() => app.store.applyBatch([op('notSupported', { spaceId: 'space-subscriber' })]), /unsupported operation/)
  } finally {
    unsubscribe()
    console.error = originalError
  }
  assert.equal(app.store.get('space-subscriber').name, 'Committed')
  assert.equal(notifications, 1)
  assert.equal(reported.length, 1)
})

test('subscribers receive committed event objects, including imports and deleted IDs', () => {
  const events = []
  const unsubscribe = app.store.subscribe(event => events.push(event))
  try {
    app.store.create({ ...space(), id: 'space-events-import' })
    app.store.create({ ...space(), id: 'space-events-delete' })
    app.store.applyBatch([op('deleteSpace', { id: 'space-events-delete', spaceId: 'space-events-import' })])
  } finally {
    unsubscribe()
  }
  assert.deepEqual(events.map(event => event.spaceIds), [['space-events-import'], ['space-events-delete'], ['space-events-delete']])
  assert.equal(events[0].operations[0].name, 'createSpace')
  assert.equal(events[2].operations[0].name, 'deleteSpace')
})

test('SQLite documents survive close and reopen', () => {
  const databasePath = join(directory, 'reopen.sqlite')
  const first = new SpaceStore(databasePath)
  first.create({ ...space(), id: 'space-persisted' })
  first.applyBatch([op('updateSpace', { id: 'space-persisted', spaceId: 'space-persisted', name: 'Persisted' })])
  first.close()
  const reopened = new SpaceStore(databasePath)
  try {
    assert.equal(reopened.get('space-persisted').name, 'Persisted')
    assert.equal(reopened.get('space-persisted').unknownFutureField.keep, true)
  } finally {
    reopened.close()
  }
})

test('attachments stream through a bounded, isolated asset directory', async () => {
  const assetsPath = join(directory, 'assets')
  const attachmentApp = createLocalServer({ databasePath: join(directory, 'attachments.sqlite'), assetsPath })
  await new Promise(resolve => attachmentApp.server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${attachmentApp.server.address().port}`
  try {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    let response = await fetch(`${base}/assets/card_1/proof.png`, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: bytes })
    assert.equal(response.status, 201)
    assert.deepEqual(await response.json(), { url: '/assets/card_1/proof.png' })
    response = await fetch(`${base}/assets/card_1/proof.png`)
    assert.equal(response.headers.get('content-type'), 'image/png')
    assert.equal(response.headers.get('content-security-policy'), 'sandbox')
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(response.headers.get('content-disposition'), null)
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes)

    response = await fetch(`${base}/assets/card_1/notes.txt`, { method: 'PUT', headers: { 'content-type': 'text/plain' }, body: 'plain text' })
    assert.equal(response.status, 201)
    response = await fetch(`${base}/assets/card_1/notes.txt`)
    assert.equal(response.headers.get('content-disposition'), "attachment; filename=\"notes.txt\"; filename*=UTF-8''notes.txt")
    assert.equal(response.headers.get('content-security-policy'), 'sandbox')
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')

    response = await fetch(`${base}/assets/card_1/document.html`, { method: 'PUT', headers: { 'content-type': 'text/html' }, body: '<script>fetch(\'/spaces\')</script>' })
    assert.equal(response.status, 201)
    response = await fetch(`${base}/assets/card_1/document.html`)
    assert.equal(response.headers.get('content-disposition'), "attachment; filename=\"document.html\"; filename*=UTF-8''document.html")
    assert.equal(response.headers.get('content-security-policy'), 'sandbox')

    response = await fetch(`${base}/assets/card_1/document.png`, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: '<script>fetch(\'/spaces\')</script>' })
    assert.equal(response.status, 201)
    response = await fetch(`${base}/assets/card_1/document.png`)
    assert.equal(response.headers.get('content-disposition'), null)
    assert.equal(response.headers.get('content-security-policy'), 'sandbox')

    response = await fetch(`${base}/assets/card_1/vector.svg`, { method: 'PUT', headers: { 'content-type': 'image/svg+xml' }, body: '<svg/>' })
    assert.equal(response.status, 201)
    assert.equal((await fetch(`${base}/assets/card_1/vector.svg`)).headers.get('content-disposition'), null)
    assert.equal((await fetch(`${base}/assets/card_1/..%2Fsecret.txt`)).status, 400)
    assert.equal((await fetch(`${base}/assets/card_1/bad.txt`, { method: 'PUT', headers: { 'content-type': 'invalid' }, body: 'x' })).status, 400)
    response = await fetch(`${base}/assets/too_large/data.txt`, { method: 'PUT', headers: { 'content-type': 'text/plain' }, body: new Uint8Array(16 * 1024 * 1024 + 1) })
    assert.equal(response.status, 413)
    await assert.rejects(readdir(join(assetsPath, 'too_large')))
  } finally {
    await new Promise(resolve => attachmentApp.server.close(resolve))
    attachmentApp.close()
  }
})

test('HTTP exposes explicit create, list, detail, and operations routes', async () => {
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve))
  const port = app.server.address().port
  const base = `http://127.0.0.1:${port}`
  const document = { ...space(), id: 'space-http' }
  delete document.drawingStrokes
  let response = await fetch(`${base}/spaces`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(document) })
  assert.equal(response.status, 201)
  assert.deepEqual((await (await fetch(`${base}/spaces/space-http`)).json()).space.drawingStrokes, [])
  response = await fetch(`${base}/operations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify([op('updateSpace', { id: 'space-http', spaceId: 'space-http', name: 'Via HTTP' })]) })
  assert.equal(response.status, 200)
  const detail = await (await fetch(`${base}/spaces/space-http`)).json()
  assert.equal(detail.space.name, 'Via HTTP')
  const listing = await (await fetch(`${base}/spaces`)).json()
  assert.equal(listing.spaces.some(item => item.id === 'space-http'), true)
  const unknown = [op('notSupported', { spaceId: 'space-http' })]
  response = await fetch(`${base}/operations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(unknown) })
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: 'unsupported operation notSupported', operations: unknown, errors: [{ status: 400, message: 'unsupported operation notSupported' }] })
  assert.equal((await fetch(`${base}/spaces/space-http`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(document) })).status, 404)
  await new Promise(resolve => app.server.close(resolve))
})
