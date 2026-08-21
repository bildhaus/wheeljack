import { layoutStickerLens, stickerLensEntryPosition, stickerLensInfluence } from "./StickerLensBackground";

test("keeps the sticker lens deterministic, bounded, and radial", () => {
  for (const [width, height] of [[960, 540], [505, 353]]) {
    const layout = layoutStickerLens(width, height);
    expect(layout).toEqual(layoutStickerLens(width, height));
    expect(layout).not.toEqual(layoutStickerLens(width, height, 8));
    expect(layout).toHaveLength(39);
    for (const [index, sticker] of layout.entries()) {
      expect(sticker.bx - sticker.width / 2).toBeGreaterThanOrEqual(0);
      expect(sticker.by - sticker.height / 2).toBeGreaterThanOrEqual(0);
      expect(sticker.bx + sticker.width / 2).toBeLessThanOrEqual(width);
      expect(sticker.by + sticker.height / 2).toBeLessThanOrEqual(height);
      const entry = stickerLensEntryPosition(sticker, width, height, index);
      const restingDistance = Math.hypot(sticker.bx - width / 2, sticker.by - height / 2);
      const entryDistance = Math.hypot(entry.x + sticker.width / 2 - width / 2, entry.y + sticker.height / 2 - height / 2);
      expect(entryDistance).toBeGreaterThan(restingDistance);
    }
  }
  expect(stickerLensInfluence(0)).toBe(1);
  expect(stickerLensInfluence(120)).toBeGreaterThan(0);
  expect(stickerLensInfluence(120)).toBeLessThan(1);
  expect(stickerLensInfluence(240)).toBe(0);
  expect(stickerLensInfluence(300)).toBe(0);
});
