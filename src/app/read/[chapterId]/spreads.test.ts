import { describe, expect, it } from "vitest";
import { spreads } from "./spreads";

describe("double-page spreads", () => {
  it("pairs pages, with the cover alone", () => {
    expect(spreads(6, true, new Set())).toEqual([[0], [1, 2], [3, 4], [5]]);
  });
  it("pairs from the first page when the cover isn't alone", () => {
    expect(spreads(5, false, new Set())).toEqual([[0, 1], [2, 3], [4]]);
  });
  it("keeps wide pages on their own and re-pairs after them", () => {
    expect(spreads(7, true, new Set([3]))).toEqual([[0], [1, 2], [3], [4, 5], [6]]);
    expect(spreads(5, false, new Set([1]))).toEqual([[0], [1], [2, 3], [4]]);
  });
  it("handles tiny chapters", () => {
    expect(spreads(0, true, new Set())).toEqual([]);
    expect(spreads(1, false, new Set())).toEqual([[0]]);
  });
});
