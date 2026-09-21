export const queueAfterSend = ({ pending, sent, acknowledged }) => {
  if (!acknowledged) return pending
  const sentIds = new Set(sent.map(item => item.body.operationId))
  return pending.filter(item => !sentIds.has(item.body.operationId))
}

export const createLocalQueue = ({ load, save }) => {
  let queue = []
  let initialized
  let sending = false
  let blocked = false
  let generation = 0

  const initialize = () => {
    initialized ||= Promise.resolve(load()).then(saved => {
      queue = saved || []
      generation++
    })
    return initialized
  }
  const persist = () => save(queue)

  return {
    initialize,
    async enqueue (operation) {
      await initialize()
      queue.push(operation)
      generation++
      await persist()
    },
    async flush (send) {
      await initialize()
      if (sending || blocked || !queue.length) return { sent: false, blocked }
      const sent = structuredClone(queue)
      sending = true
      try {
        const response = await send(sent)
        if (!response.ok) {
          const error = new Error(response.statusText)
          error.status = response.status
          throw error
        }
        queue = queueAfterSend({ pending: queue, sent, acknowledged: true })
        generation++
        await persist()
        return { sent: true, drained: !queue.length }
      } catch (error) {
        blocked = error.status >= 400 && error.status < 500
        await persist()
        return { sent: false, blocked, error }
      } finally {
        sending = false
      }
    },
    get idle () { return !sending && !queue.length },
    get pending () { return queue },
    get generation () { return generation },
    get blocked () { return blocked }
  }
}
