import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import cache from '../../src/cache.js'
import { useApiStore } from '../../src/stores/useApiStore.js'
import { useCardStore } from '../../src/stores/useCardStore.js'
import { useHistoryStore } from '../../src/stores/useHistoryStore.js'
import { useSpaceStore } from '../../src/stores/useSpaceStore.js'
import { useUserStore } from '../../src/stores/useUserStore.js'

const remoteSpace = (id, name) => ({
  id,
  name: 'Test space',
  cards: [{ id: 'card-1', name, x: 0, y: 0, width: 200, height: 100 }],
  boxes: [],
  connections: [],
  lines: [],
  lists: [],
  users: [{ id: 'user-1' }],
  spectators: []
})

const waitForHistory = () => new Promise(resolve => setTimeout(resolve, 300))

describe('local canonical reconciliation history', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(cache, 'updateSpace').mockResolvedValue()
  })

  it('keeps a saved local edit undoable and redoable after same-space reconciliation', async () => {
    const spaceStore = useSpaceStore()
    const cardStore = useCardStore()
    const historyStore = useHistoryStore()
    const persist = vi.fn()
    useApiStore().addToQueue = persist
    useUserStore().$patch({ id: 'user-1', apiKey: 'test-key' })
    historyStore.init()

    await spaceStore.restoreSpaceRemote(remoteSpace('space-1', 'before'))
    await cardStore.updateCard({ id: 'card-1', name: 'after' })
    await waitForHistory()
    expect(historyStore.pointer).toBe(1)

    await spaceStore.restoreSpaceRemote(remoteSpace('space-1', 'after'), {
      replayLocalHistory: false,
      resetHistory: false
    })

    expect(historyStore.pointer).toBe(1)
    await historyStore.undo()
    expect(cardStore.getCard('card-1').name).toBe('before')
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({
      name: 'updateCard',
      body: expect.objectContaining({ id: 'card-1', name: 'before' })
    }))
    await historyStore.redo()
    expect(cardStore.getCard('card-1').name).toBe('after')
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({
      name: 'updateCard',
      body: expect.objectContaining({ id: 'card-1', name: 'after' })
    }))
  })

  it('clears history on a normal remote space load', async () => {
    const spaceStore = useSpaceStore()
    const cardStore = useCardStore()
    const historyStore = useHistoryStore()
    historyStore.init()

    await spaceStore.restoreSpaceRemote(remoteSpace('space-1', 'before'))
    await cardStore.updateCard({ id: 'card-1', name: 'after' })
    await waitForHistory()

    await spaceStore.restoreSpaceRemote(remoteSpace('space-2', 'other'))
    expect(historyStore.pointer).toBe(0)
    expect(historyStore.patches).toEqual([])
  })
})
