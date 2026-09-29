import WebSocket from 'ws'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'

export async function connect ({ url = 'ws://127.0.0.1:8081/ws', id, name, color }) {
  if (!id || !name || !color) throw new Error('id, name and color are required')
  const socket = new WebSocket(url)
  await once(socket, 'open')
  const clientId = `${id}-${randomUUID()}`
  const user = { id, name, color, isSpectator: true, isCollaborator: false }
  let spaceId
  const send = message => {
    if (!spaceId) throw new Error('join a space before sending presence')
    socket.send(JSON.stringify({ message, spaceId, clientId, user }))
  }
  return {
    join (id) {
      if (!id) throw new Error('spaceId is required')
      spaceId = id
      send({ name: 'joinSpaceRoom' })
    },
    cursor (x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('cursor position must be finite')
      send({ action: 'triggerUpdateRemoteUserCursor', updates: { userId: user.id, x, y } })
    },
    select (cardIds) {
      if (!Array.isArray(cardIds)) throw new Error('cardIds must be an array')
      send({ action: 'updateRemoteCardsSelected', updates: { userId: user.id, cardIds } })
    },
    leave () {
      if (spaceId) send({ name: 'userLeftRoom' })
      spaceId = undefined
      socket.close()
    }
  }
}
