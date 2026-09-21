import { DatabaseSync } from 'node:sqlite'

const REQUIRED_COLLECTIONS = ['cards', 'connections', 'boxes', 'lists', 'lines', 'tags', 'drawingStrokes']
const REQUEST_METADATA = new Set(['operationId', 'clientCreatedAt'])
const SPACE_TARGET_OPERATIONS = new Set(['updateSpace', 'removeSpace', 'deleteSpace'])
const ENTITY_OPERATIONS = new Map([
  ['createCard', ['create', 'cards']], ['updateCard', ['update', 'cards']], ['deleteCard', ['delete', 'cards']], ['restoreRemovedCard', ['restore', 'cards']],
  ['createConnection', ['create', 'connections']], ['updateConnection', ['update', 'connections']], ['removeConnection', ['remove', 'connections']],
  ['createBox', ['create', 'boxes']], ['updateBox', ['update', 'boxes']], ['removeBox', ['remove', 'boxes']],
  ['createList', ['create', 'lists']], ['updateList', ['update', 'lists']], ['removeList', ['remove', 'lists']],
  ['createLine', ['create', 'lines']], ['updateLine', ['update', 'lines']], ['removeLine', ['remove', 'lines']]
])

export class OperationError extends Error {
  constructor (message, status = 400) {
    super(message)
    this.status = status
  }
}

const clone = value => structuredClone(value)
const object = (value, message) => {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new OperationError(message)
  return value
}
const id = (value, message = 'missing id') => {
  if (typeof value !== 'string' || !value) throw new OperationError(message)
  return value
}
const without = (body, keys) => Object.fromEntries(Object.entries(body).filter(([key]) => !keys.has(key)))

const validateSpace = space => {
  object(space, 'space must be an object')
  id(space.id, 'space missing id')
  for (const key of REQUIRED_COLLECTIONS) {
    if (!Array.isArray(space[key])) throw new OperationError(`space missing ${key} array`)
  }
  return space
}

const validateDrawingStroke = stroke => {
  if (!Array.isArray(stroke) || !stroke.length) throw new OperationError('drawing stroke must be non-empty')
  let strokeId
  for (const point of stroke) {
    object(point, 'drawing point must be an object')
    const pointId = id(point.id, 'drawing point missing id')
    if (strokeId && pointId !== strokeId) throw new OperationError('drawing points must have the same id')
    strokeId = pointId
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new OperationError('drawing point must have finite x and y')
    if (!Number.isFinite(point.diameter) || point.diameter <= 0) throw new OperationError('drawing point diameter must be positive and finite')
    if (typeof point.color !== 'string') throw new OperationError('drawing point color must be a string')
  }
  return stroke
}

export class SpaceStore {
  constructor (databasePath) {
    this.db = new DatabaseSync(databasePath)
    this.db.exec('CREATE TABLE IF NOT EXISTS spaces (id TEXT PRIMARY KEY, document TEXT NOT NULL)')
    this.db.exec('CREATE TABLE IF NOT EXISTS applied_operations (operation_id TEXT PRIMARY KEY)')
    this.subscribers = new Set()
  }

  close () { this.db.close() }

  subscribe (listener) {
    this.subscribers.add(listener)
    return () => this.subscribers.delete(listener)
  }

  list () {
    return this.db.prepare('SELECT document FROM spaces ORDER BY rowid').all().map(row => JSON.parse(row.document))
  }

  get (spaceId) {
    const row = this.db.prepare('SELECT document FROM spaces WHERE id = ?').get(spaceId)
    return row && JSON.parse(row.document)
  }

  create (space, { defaultDrawingStrokes = false } = {}) {
    space = clone(space)
    if (defaultDrawingStrokes && !Object.hasOwn(space, 'drawingStrokes')) space.drawingStrokes = []
    validateSpace(space)
    if (this.get(space.id)) throw new OperationError(`space ${space.id} already exists`, 409)
    this.db.prepare('INSERT INTO spaces (id, document) VALUES (?, ?)').run(space.id, JSON.stringify(space))
    this.#notify({ operations: [{ name: 'createSpace', body: clone(space) }], spaceIds: [space.id] })
    return clone(space)
  }

  #save (space) {
    this.db.prepare('UPDATE spaces SET document = ? WHERE id = ?').run(JSON.stringify(space), space.id)
  }

  #notify (event) {
    for (const listener of this.subscribers) {
      try {
        listener(event)
      } catch (error) {
        console.error('Kinopio local server subscriber failed', error)
      }
    }
  }

  applyBatch (operations) {
    if (!Array.isArray(operations) || !operations.length) throw new OperationError('operations must be a non-empty array')
    const documents = new Map()
    const changed = new Set()
    const deleted = new Set()
    const getSpace = spaceId => {
      if (deleted.has(spaceId)) throw new OperationError(`space ${spaceId} not found`, 404)
      if (!documents.has(spaceId)) {
        const space = this.get(spaceId)
        if (!space) throw new OperationError(`space ${spaceId} not found`, 404)
        documents.set(spaceId, space)
      }
      return documents.get(spaceId)
    }

    const materializeDocuments = () => {
      for (const saved of this.list()) {
        if (!documents.has(saved.id) && !deleted.has(saved.id)) documents.set(saved.id, saved)
      }
    }

    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const operation of operations) {
        object(operation, 'operation must be an object')
        const { name } = operation
        const body = object(operation.body, 'operation body must be an object')
        const operationId = id(body.operationId, 'operation missing operationId')
        const inserted = this.db.prepare('INSERT INTO applied_operations (operation_id) VALUES (?) ON CONFLICT DO NOTHING').run(operationId)
        if (!inserted.changes) continue
        if (name === 'createSpace') {
          const space = without(body, new Set([...REQUEST_METADATA, 'spaceId']))
          validateSpace(space)
          if (this.get(space.id) || documents.has(space.id)) throw new OperationError(`space ${space.id} already exists`, 409)
          documents.set(space.id, space)
          changed.add(space.id)
          continue
        }
        if (name === 'deleteAllRemovedSpaces') {
          materializeDocuments()
          for (const [spaceId, saved] of documents) {
            if (!saved.isRemoved) continue
            documents.delete(spaceId)
            changed.delete(spaceId)
            deleted.add(spaceId)
          }
          continue
        }
        const spaceId = SPACE_TARGET_OPERATIONS.has(name)
          ? id(body.id || body.spaceId, `${name} missing id`)
          : id(body.spaceId, `${name} missing spaceId`)
        if (name === 'deleteSpace') {
          getSpace(spaceId)
          documents.delete(spaceId)
          changed.delete(spaceId)
          deleted.add(spaceId)
          continue
        }
        const space = getSpace(spaceId)
        applyOperation(space, name, body)
        changed.add(spaceId)
      }
      for (const spaceId of changed) validateSpace(documents.get(spaceId))
      for (const spaceId of deleted) this.db.prepare('DELETE FROM spaces WHERE id = ?').run(spaceId)
      for (const spaceId of changed) {
        const space = documents.get(spaceId)
        if (this.get(spaceId)) this.#save(space)
        else this.db.prepare('INSERT INTO spaces (id, document) VALUES (?, ?)').run(spaceId, JSON.stringify(space))
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }

    const event = { operations: clone(operations), spaceIds: [...new Set([...changed, ...deleted])] }
    this.#notify(event)
    return event
  }
}

function applyOperation (space, name, body) {
  if (name === 'updateSpace') {
    Object.assign(space, without(body, new Set([...REQUEST_METADATA, 'id', 'spaceId', 'userId'])))
    return
  }
  if (name === 'removeSpace') {
    space.isRemoved = true
    return
  }
  if (name === 'clearDrawing') {
    space.drawingStrokes = []
    return
  }
  if (name === 'createDrawingStroke') {
    const stroke = validateDrawingStroke(body.stroke)
    space.drawingStrokes.push(clone(stroke))
    return
  }
  if (name === 'removeDrawingStroke') {
    const strokeId = body.stroke?.[0]?.id
    if (typeof strokeId !== 'string') throw new OperationError('removeDrawingStroke missing stroke id')
    space.drawingStrokes = space.drawingStrokes.filter(stroke => stroke[0]?.id !== strokeId)
    return
  }
  if (name === 'updateTags') {
    const tags = body.tags
    if (!Array.isArray(tags)) throw new OperationError('updateTags missing tags')
    const tagIds = new Set(tags.map(tag => id(object(tag, 'updateTags tag must be an object').id, 'tag missing id')))
    space.tags = space.tags.filter(tag => !tagIds.has(tag.id)).concat(clone(tags))
    return
  }
  if (name === 'removeTag') {
    space.tags = space.tags.filter(tag => tag.id !== id(body.id, 'removeTag missing id'))
    return
  }
  if (name === 'removeTagsByName') {
    if (typeof body.name !== 'string') throw new OperationError('removeTagsByName missing name')
    space.tags = space.tags.filter(tag => tag.name !== body.name)
    return
  }
  if (name === 'updateTagColorByName') {
    const tag = object(body.tag, 'updateTagColorByName missing tag')
    if (typeof tag.name !== 'string') throw new OperationError('updateTagColorByName missing tag name')
    space.tags.forEach(existing => { if (existing.name === tag.name) existing.color = tag.color })
    return
  }
  if (name === 'deleteAllRemovedCards') {
    space.cards = space.cards.filter(card => !card.isRemoved)
    return
  }

  const operation = ENTITY_OPERATIONS.get(name)
  if (!operation) throw new OperationError(`unsupported operation ${name}`)
  const [action, collectionName] = operation
  const collection = space[collectionName]
  const entityId = id(body.id, `${name} missing id`)
  const index = collection.findIndex(entity => entity.id === entityId)

  if (action === 'create') {
    if (index !== -1) throw new OperationError(`entity ${entityId} already exists`, 409)
    const entity = without(body, REQUEST_METADATA)
    entity.spaceId = space.id
    collection.push(entity)
    return
  }
  if (action === 'restore') {
    if (index === -1) {
      const entity = without(body, REQUEST_METADATA)
      entity.spaceId = space.id
      entity.isRemoved = false
      collection.push(entity)
    } else if (collection[index].isRemoved) {
      collection[index].isRemoved = false
    }
    return
  }
  if (action === 'update') {
    const update = without(body, new Set([...REQUEST_METADATA, 'spaceId', 'userId']))
    // Snap-alignment cleanup sends only { id } after JSON removes its undefined display fields.
    if (name === 'updateCard' && Object.keys(update).length === 1) return
    if (index === -1) throw new OperationError(`entity ${entityId} not found`, 404)
    Object.assign(collection[index], update)
    return
  }
  if (index === -1) return
  collection.splice(index, 1)
}
