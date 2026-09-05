import { vi } from "vitest";
import { loadStickerArtwork, layoutStickerLens, stickerLensEntryPosition, stickerLensInfluence } from "./StickerLensBackground";

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


test("artwork loads as bundled assets once and retains theme recoloring", async () => {
  const fetchAsset = vi.fn(async (_url: string) => ({ ok: true, text: async () => '<svg fill="#d94f2b"><path /></svg>' }));
  vi.stubGlobal("fetch", fetchAsset);
  try {
    const first = loadStickerArtwork();
    const second = loadStickerArtwork();
    expect(second).toBe(first);
    const artwork = await first;
    expect(fetchAsset).toHaveBeenCalledTimes(39);
    expect(artwork).toHaveLength(39);
    expect(artwork.every((svg) => svg.includes('fill="currentColor"'))).toBe(true);
    expect(fetchAsset.mock.calls.every(([url]) => typeof url === "string" && !url.startsWith("data:"))).toBe(true);
  } finally {
    vi.unstubAllGlobals();
  }
});
