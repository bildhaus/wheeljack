import { hexToHsv, hsvToHex } from "./colorPicker";

test("round-trips opaque theme colors through HSV", () => {
  for (const value of ["#000000", "#FFFFFF", "#FF7A45", "#2F81F7", "#12AB34"]) {
    expect(hsvToHex(hexToHsv(value))).toBe(value);
  }
});

test("maps primary HSV colors to hex", () => {
  expect(hsvToHex({ h: 0, s: 100, v: 100 })).toBe("#FF0000");
  expect(hsvToHex({ h: 120, s: 100, v: 100 })).toBe("#00FF00");
  expect(hsvToHex({ h: 240, s: 100, v: 100 })).toBe("#0000FF");
});
