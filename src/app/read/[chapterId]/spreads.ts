/**
 * Group page indexes into double-page spreads. Wide pages (already a two-page spread in one image) always
 * stand alone, and so does the cover when `coverAlone` is set, so facing pages stay correctly paired.
 */
export function spreads(count: number, coverAlone: boolean, wide: ReadonlySet<number>): number[][] {
  const groups: number[][] = [];
  let i = 0;
  if (coverAlone && count > 0) {
    groups.push([0]);
    i = 1;
  }
  while (i < count) {
    if (wide.has(i) || i + 1 >= count || wide.has(i + 1)) {
      groups.push([i]);
      i += 1;
    } else {
      groups.push([i, i + 1]);
      i += 2;
    }
  }
  return groups;
}
