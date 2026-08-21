import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { RunStateBadge } from "./RunStateBadge";

describe("RunStateBadge", () => {
  test("omits generic working badges while retaining actionable and outcome states", () => {
    expect(renderToStaticMarkup(<RunStateBadge status="running" />)).toBe("");
    expect(renderToStaticMarkup(<RunStateBadge status="in_progress" />)).toBe("");
    expect(renderToStaticMarkup(<RunStateBadge status="working" />)).toBe("");

    const exceptional = renderToStaticMarkup(<>
      <RunStateBadge status="needs_input" />
      <RunStateBadge status="verified" />
      <RunStateBadge status="failed" />
    </>);
    expect(exceptional).toContain('aria-label="Needs input"');
    expect(exceptional).toContain('aria-label="Verified"');
    expect(exceptional).toContain('aria-label="Failed"');
  });

  test("keeps meaningful active labels", () => {
    expect(renderToStaticMarkup(<RunStateBadge status="running" label="Running tests" />)).toContain("Running tests");
    expect(renderToStaticMarkup(<RunStateBadge status="delivering" />)).toContain("Delivering");
  });
});
