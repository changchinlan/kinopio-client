import { describe, expect, it } from 'vitest'
import newSpace from '../../src/data/new.json'
import { isPlaceholderSpaceId } from '../../src/localServer.js'

describe('placeholder space', () => {
  it('matches the id of the space store before a real space loads', () => {
    expect(isPlaceholderSpaceId(newSpace.id)).toBe(true)
    expect(isPlaceholderSpaceId('yxuOhpQTOifnIfeUisnuI')).toBe(false)
  })
})
