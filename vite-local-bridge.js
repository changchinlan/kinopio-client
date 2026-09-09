import { validateCommand } from './src/localBridgeProtocol.js'

const maxBodyBytes = 64 * 1024
const commandTimeoutMs = 5000

const readJson = (request) => new Promise((resolve, reject) => {
  let body = ''
  let size = 0
  request.setEncoding('utf8')
  request.on('data', chunk => {
    size += Buffer.byteLength(chunk)
    if (size > maxBodyBytes) {
      reject(new Error('request body is too large'))
      request.destroy()
      return
    }
    body += chunk
  })
  request.on('end', () => {
    try {
      resolve(JSON.parse(body))
    } catch {
      reject(new Error('request body must be JSON'))
    }
  })
  request.on('error', reject)
})

const sendJson = (response, status, body) => {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify(body))
}

export default function localBridge () {
  const pending = new Map()
  let activeClient

  const settle = (id, result) => {
    const request = pending.get(id)
    if (!request) return
    clearTimeout(request.timer)
    pending.delete(id)
    sendJson(request.response, result.ok ? 200 : 422, result)
  }

  return {
    name: 'local-bridge',
    apply: 'serve',
    configureServer (server) {
      server.ws.on('kaoru:ready', (_data, client) => {
        activeClient = client
      })
      server.ws.on('kaoru:result', (result, client) => {
        if (client !== activeClient || !result || typeof result.id !== 'string') return
        settle(result.id, result)
      })
      server.middlewares.use('/__kaoru/command', async (request, response, next) => {
        if (request.method !== 'POST') return next()
        try {
          const command = await readJson(request)
          const error = validateCommand(command)
          if (error) return sendJson(response, 400, { ok: false, error })
          if (!activeClient) {
            return sendJson(response, 503, { ok: false, error: 'No active Kinopio board tab is connected.' })
          }
          if (pending.has(command.id)) {
            return sendJson(response, 409, { ok: false, error: `Request ID already pending: ${command.id}` })
          }
          const timer = setTimeout(() => {
            pending.delete(command.id)
            activeClient = undefined
            sendJson(response, 504, { ok: false, error: 'Timed out waiting for the active Kinopio board tab.' })
          }, commandTimeoutMs)
          pending.set(command.id, { response, timer })
          activeClient.send('kaoru:command', command)
        } catch (error) {
          sendJson(response, 400, { ok: false, error: error.message })
        }
      })
    }
  }
}
