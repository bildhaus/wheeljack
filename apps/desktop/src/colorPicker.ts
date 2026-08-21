export interface HsvColor {
  h: number;
  s: number;
  v: number;
}

export function hexToHsv(hex: string): HsvColor {
  const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : "000000";
  const red = Number.parseInt(normalized.slice(0, 2), 16) / 255;
  const green = Number.parseInt(normalized.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(normalized.slice(4, 6), 16) / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  let hue = 0;
  if (delta) {
    if (maximum === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (maximum === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  return {
    h: (hue + 360) % 360,
    s: (maximum ? delta / maximum : 0) * 100,
    v: maximum * 100,
  };
}

export function hsvToHex({ h, s, v }: HsvColor): string {
  const hue = ((h % 360) + 360) % 360;
  const saturation = clamp(s, 0, 100) / 100;
  const value = clamp(v, 0, 100) / 100;
  const chroma = value * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const match = value - chroma;
  const [red, green, blue] =
    hue < 60 ? [chroma, x, 0] :
      hue < 120 ? [x, chroma, 0] :
        hue < 180 ? [0, chroma, x] :
          hue < 240 ? [0, x, chroma] :
            hue < 300 ? [x, 0, chroma] :
              [chroma, 0, x];
  return `#${[red, green, blue]
    .map((channel) => Math.round((channel + match) * 255).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
