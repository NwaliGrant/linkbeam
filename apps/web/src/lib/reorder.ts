/** Returns a new array with the item at `from` moved to `to`. Out-of-range moves leave the list as it is. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const copy = [...list];
  if (from < 0 || from >= copy.length || to < 0 || to >= copy.length || from === to) return copy;
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item as T);
  return copy;
}

/** Which row a pointer is over, from the vertical middle of each row. Used for drag and drop. */
export function indexAtY(middles: readonly number[], y: number): number {
  if (middles.length === 0) return 0;
  let best = 0;
  let distance = Number.POSITIVE_INFINITY;
  middles.forEach((middle, index) => {
    const d = Math.abs(middle - y);
    if (d < distance) {
      distance = d;
      best = index;
    }
  });
  return best;
}
