// Category order (issue #408): the order of the category list sets the order
// of the timeline's category lanes and of the filter chips. Settings moves a
// category one place up or down.

// Returns a new list with the item at `index` moved by `delta` places, or the
// same list when the move would leave the list's bounds.
export function moveItem(list, index, delta) {
  const to = index + delta
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list
  const next = [...list]
  const [item] = next.splice(index, 1)
  next.splice(to, 0, item)
  return next
}
