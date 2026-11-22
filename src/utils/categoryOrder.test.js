import { describe, it, expect } from 'vitest'
import { moveItem } from './categoryOrder.js'

describe('moveItem', () => {
  const list = ['a', 'b', 'c']

  it('moves an item up or down one place', () => {
    expect(moveItem(list, 2, -1)).toEqual(['a', 'c', 'b'])
    expect(moveItem(list, 0, 1)).toEqual(['b', 'a', 'c'])
  })

  it('leaves the list as it is at either end', () => {
    expect(moveItem(list, 0, -1)).toBe(list)
    expect(moveItem(list, 2, 1)).toBe(list)
  })

  it('does not change the list it is given', () => {
    moveItem(list, 1, 1)
    expect(list).toEqual(['a', 'b', 'c'])
  })
})
