import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom does not implement these, and wheeljack surfaces use them during mount.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof window.ResizeObserver;
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined;
}

if (!window.CSS.escape) {
  window.CSS.escape = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
}

afterEach(() => {
  cleanup();
});
