import { describe, expect, it } from 'vitest'
import { resolveIdPrefix, validateCommand } from '../../src/localBridgeProtocol.js'

describe('local bridge protocol', () => {
  it('accepts the small command allowlist', () => {
    const commands = [
      { id: 'snapshot', action: 'snapshot', params: {} },
      { id: 'create', action: 'card.create', params: { name: 'Hello', x: 0, y: 12 } },
      { id: 'update', action: 'card.update', params: { id: 'card-id', name: 'Renamed' } },
      { id: 'move', action: 'card.move', params: { id: 'card-id', x: 10, y: 20 } },
      { id: 'connect', action: 'connection.create', params: { startItemId: 'a', endItemId: 'b' } }
    ]
    commands.forEach(command => expect(validateCommand(command)).toBeUndefined())
  })

  it('rejects unknown actions and extra fields', () => {
    expect(validateCommand({ id: 'x', action: 'card.delete', params: {} })).toMatch('unsupported')
    expect(validateCommand({ id: 'x', action: 'card.create', params: { name: 'Hello', evil: true } })).toMatch('invalid')
  })

  it('resolves exact IDs and unambiguous prefixes', () => {
    const items = [{ id: 'abcdefgh' }, { id: 'abcdefgh-more' }, { id: 'abcdefzz' }, { id: 'qwertyui' }]
    expect(resolveIdPrefix(items, 'qwer').item.id).toBe('qwertyui')
    expect(resolveIdPrefix(items, 'abcdefgh').item.id).toBe('abcdefgh')
    expect(resolveIdPrefix(items, 'abc').error).toMatch('Ambiguous')
    expect(resolveIdPrefix(items, 'missing').error).toMatch('No current-space item')
  })
})
