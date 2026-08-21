import { describe, expect, it } from "vitest";
import { dotMatrixLoaderAssets } from "./DotMatrixLoader";

describe("dot matrix loader assets", () => {
  it("keeps each semantic state on its selected source animation", () => {
    expect(dotMatrixLoaderAssets).toEqual({
      boot: "/dot-matrix/icon-53.svg",
      loading: "/dot-matrix/icon-07.svg",
      thinking: "/dot-matrix/icon-19.svg",
      compile: "/dot-matrix/icon-28.svg",
      verify: "/dot-matrix/icon-38.svg",
    });
  });
});
