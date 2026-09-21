import http from 'node:http'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { SpaceStore, OperationError } from './state.js'

const maxUploadBytes = 16 * 1024 * 1024
const attachmentIdPattern = /^[A-Za-z0-9_-]{1,128}$/
const attachmentNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/
const mimeTypePattern = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+\/[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const inlineAttachmentMimeTypes = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/mpeg', 'audio/mp4', 'audio/ogg'
])

const attachmentDisposition = name => `attachment; filename="${name.replace(/["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`

const assetResponseHeaders = (contentType, name) => ({
  'content-type': contentType,
  'cache-control': 'no-store',
  'content-security-policy': 'sandbox',
  'x-content-type-options': 'nosniff',
  ...(inlineAttachmentMimeTypes.has(contentType) ? {} : { 'content-disposition': attachmentDisposition(name) })
})

const attachmentPath = (assetsPath, id, name) => {
  if (!attachmentIdPattern.test(id) || !attachmentNamePattern.test(name)) {
    throw new OperationError('invalid attachment path')
  }
  const root = resolve(assetsPath)
  const file = resolve(root, id, name)
  if (!file.startsWith(`${root}/`)) throw new OperationError('invalid attachment path')
  return file
}

const attachmentMimeType = request => {
  const type = request.headers['content-type']?.split(';', 1)[0]?.trim()
  if (!type || !mimeTypePattern.test(type) || type.length > 127) {
    throw new OperationError('invalid attachment MIME type')
  }
  return type.toLowerCase()
}

const receiveAttachment = async ({ request, assetsPath, id, name }) => {
  const contentLength = Number(request.headers['content-length'])
  if (Number.isFinite(contentLength) && contentLength > maxUploadBytes) {
    throw new OperationError('attachment body too large', 413)
  }
  const contentType = attachmentMimeType(request)
  const file = attachmentPath(assetsPath, id, name)
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.${Date.now()}.partial`
  let received = 0
  const limit = new Transform({
    transform (chunk, encoding, callback) {
      received += chunk.length
      if (received > maxUploadBytes) callback(new OperationError('attachment body too large', 413))
      else callback(null, chunk)
    }
  })
  try {
    await pipeline(request, limit, createWriteStream(temporary, { flags: 'wx' }))
    await rename(temporary, file)
    await writeFile(`${dirname(file)}/.${basename(file)}.content-type`, contentType, 'utf8')
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

const json = (response, status, body) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

const readJson = request => new Promise((resolve, reject) => {
  let data = ''
  request.setEncoding('utf8')
  request.on('data', chunk => {
    data += chunk
    if (data.length > 10 * 1024 * 1024) request.destroy(new OperationError('request body too large', 413))
  })
  request.on('end', () => {
    try { resolve(data ? JSON.parse(data) : {}) } catch { reject(new OperationError('invalid JSON')) }
  })
  request.on('error', reject)
})

export const createLocalServer = ({ databasePath = 'kinopio-local.sqlite', assetsPath = `${databasePath}.assets` } = {}) => {
  const store = new SpaceStore(databasePath)
  const eventClients = new Set()
  const unsubscribe = store.subscribe(event => {
    const message = `data: ${JSON.stringify(event)}\n\n`
    for (const response of eventClients) response.write(message)
  })
  const server = http.createServer(async (request, response) => {
    let url
    let operations
    try {
      url = new URL(request.url, `http://${request.headers.host}`)
      const path = url.pathname.split('/').filter(Boolean)
      if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, { ok: true })
      if (path[0] === 'assets' && path[1] && path[2] && path.length === 3) {
        const id = decodeURIComponent(path[1])
        const name = decodeURIComponent(path[2])
        const file = attachmentPath(assetsPath, id, name)
        if (request.method === 'PUT') {
          await receiveAttachment({ request, assetsPath, id, name })
          return json(response, 201, { url: `/assets/${encodeURIComponent(id)}/${encodeURIComponent(name)}` })
        }
        if (request.method === 'GET') {
          await stat(file).catch(() => { throw new OperationError('attachment not found', 404) })
          const contentType = await readFile(`${dirname(file)}/.${basename(file)}.content-type`, 'utf8').catch(() => 'application/octet-stream')
          response.writeHead(200, assetResponseHeaders(contentType, name))
          createReadStream(file).on('error', () => response.destroy()).pipe(response)
          return
        }
      }
      if (request.method === 'GET' && url.pathname === '/events') {
        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive'
        })
        response.write(': connected\n\n')
        eventClients.add(response)
        request.on('close', () => eventClients.delete(response))
        return
      }
      if (request.method === 'GET' && url.pathname === '/spaces') return json(response, 200, { spaces: store.list() })
      if (path[0] === 'spaces' && path[1] && path.length === 2 && request.method === 'GET') {
        const spaceId = decodeURIComponent(path[1])
        const space = store.get(spaceId)
        if (!space) throw new OperationError(`space ${spaceId} not found`, 404)
        return json(response, 200, { space })
      }
      if (request.method === 'POST' && url.pathname === '/spaces') {
        const space = await readJson(request)
        return json(response, 201, { space: store.create(space, { defaultDrawingStrokes: true }) })
      }
      if (request.method === 'POST' && url.pathname === '/operations') {
        operations = await readJson(request)
        const result = store.applyBatch(operations)
        return json(response, 200, result)
      }
      json(response, 404, { error: 'not found' })
    } catch (error) {
      const status = error.status || 500
      if (url?.pathname === '/operations') {
        return json(response, status, { error: error.message || 'internal server error', operations, errors: [{ status, message: error.message || 'internal server error' }] })
      }
      json(response, status, { error: error.message || 'internal server error' })
    }
  })
  return {
    server,
    store,
    close: () => {
      unsubscribe()
      for (const response of eventClients) response.end()
      store.close()
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.KINOPIO_LOCAL_PORT || 8081)
  const databasePath = process.env.KINOPIO_LOCAL_DB || 'kinopio-local.sqlite'
  const assetsPath = process.env.KINOPIO_LOCAL_ASSETS || `${databasePath}.assets`
  const { server } = createLocalServer({ databasePath, assetsPath })
  server.listen(port, '127.0.0.1', () => console.log(`Kinopio local server listening on http://127.0.0.1:${port}`))
}
