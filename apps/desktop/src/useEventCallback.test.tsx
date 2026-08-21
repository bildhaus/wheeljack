import { renderHook } from "@testing-library/react";
import { vi } from "vitest";
import { useEventCallback } from "./useEventCallback";

test("keeps callback identity stable while dispatching to the latest implementation", () => {
  const first = vi.fn((value: string) => `first:${value}`);
  const second = vi.fn((value: string) => `second:${value}`);
  const { result, rerender } = renderHook(({ callback }) => useEventCallback(callback), {
    initialProps: { callback: first },
  });
  const stable = result.current;

  expect(stable("one")).toBe("first:one");
  rerender({ callback: second });

  expect(result.current).toBe(stable);
  expect(result.current("two")).toBe("second:two");
  expect(first).toHaveBeenCalledOnce();
  expect(second).toHaveBeenCalledOnce();
});
