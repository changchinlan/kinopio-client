import { describe, expect, it, vi } from 'vitest'
import { createLocalQueue } from '../../src/localQueue.js'
import { canApplyLocalSnapshot, postLocalOperations } from '../../src/localTransport.js'

const operation = id => ({ name: 'updateCard', body: { operationId: id } })
const response = (status = 200) => ({ ok: status >= 200 && status < 300, status, statusText: `HTTP ${status}` })

describe('local adapter outbox', () => {
  it('awaits request options and posts the queued operation body', async () => {
    const requestOptions = vi.fn(async ({ body, method }) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
    const fetchImpl = vi.fn(async () => response())
    const operations = [operation('one')]

    await postLocalOperations({ operations, requestOptions, fetchImpl })

    expect(fetchImpl).toHaveBeenCalledWith('/local-api/operations', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(operations)
    })
  })

  it('retains a failed request in both durable saves, then acknowledges only sent operations', async () => {
    const saved = []
    const queue = createLocalQueue({ load: async () => [], save: async pending => saved.push(structuredClone(pending)) })
    await queue.enqueue(operation('one'))

    const failed = await queue.flush(async () => response(503))
    expect(failed.sent).toBe(false)
    expect(queue.pending).toEqual([operation('one')])
    expect(saved.at(-1)).toEqual([operation('one')])

    const sent = await queue.flush(async () => response())
    expect(sent).toMatchObject({ sent: true, drained: true })
    expect(queue.pending).toEqual([])
  })

  it('rejects a stale reconciliation response after an edit or navigation', () => {
    const snapshot = { targetId: 'space-a', activeTargetId: 'space-a', reconciliation: true, startedGeneration: 3, currentGeneration: 3, queueIdle: true }
    expect(canApplyLocalSnapshot(snapshot)).toBe(true)
    expect(canApplyLocalSnapshot({ ...snapshot, currentGeneration: 4 })).toBe(false)
    expect(canApplyLocalSnapshot({ ...snapshot, activeTargetId: 'space-b' })).toBe(false)
  })

  it('waits for restored operations before accepting an enqueue and blocks permanent rejection', async () => {
    let resolveLoad
    const queue = createLocalQueue({
      load: () => new Promise(resolve => { resolveLoad = resolve }),
      save: async () => {}
    })
    const enqueued = queue.enqueue(operation('new'))
    resolveLoad([operation('restored')])
    await enqueued

    expect(queue.pending).toEqual([operation('restored'), operation('new')])
    expect((await queue.flush(async () => response(400))).blocked).toBe(true)
    expect((await queue.flush(async () => response())).sent).toBe(false)
  })
})
