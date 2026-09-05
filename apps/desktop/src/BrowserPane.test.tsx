import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import BrowserPane from "./BrowserPane";
import type { CanvasNode, LifecycleRun } from "./types";

const core = vi.hoisted(() => ({ callCore: vi.fn() }));
vi.mock("./core", () => core);
const node: CanvasNode = { id: "browser", canvasId: "canvas", kind: "browser_preview", title: "App", x: 0, y: 0, width: 600, height: 400, zIndex: 1, data: {}, createdAt: "", updatedAt: "" };
let currentRun: LifecycleRun;
beforeEach(() => {
  currentRun = { id: "preview-run", projectId: "project", kind: "preview", state: "running", command: ["dev"], url: "http://127.0.0.1:4321/", startedAt: "", updatedAt: "" };
  core.callCore.mockReset().mockImplementation(async (method: string) => {
    if (method === "project_lifecycle_inspect") return { trusted: true, hash: "trusted-hash", preview: { command: ["dev"] } };
    if (method === "project_lifecycle_current") return null;
    if (method === "project_lifecycle_start") return { ...currentRun };
    if (method === "project_lifecycle_runs") return [{ ...currentRun }];
    if (method === "project_lifecycle_logs") return { text: "Dev server output" };
    return undefined;
  });
});

test("cold previews wait for native readiness and Reload performs a real navigation", async () => {
  const user = userEvent.setup();
  render(<BrowserPane node={node} projectId="project" projectRoot="C:/repo" onSave={vi.fn()} />);
  await user.click(await screen.findByRole("button", { name: "Start preview" }));
  expect(screen.queryByTitle("Browser preview App")).toBeNull();
  expect(screen.getByText("Starting preview. Waiting for the server…")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Reload" }) as HTMLButtonElement).disabled).toBe(true);
  currentRun.state = "ready";
  const frame = await screen.findByTitle("Browser preview App", {}, { timeout: 2000 });
  expect(frame.getAttribute("src")).toBe(currentRun.url);
  await user.click(screen.getByRole("button", { name: "Reload" }));
  const refreshed = screen.getByTitle("Browser preview App");
  expect(refreshed).not.toBe(frame);
  expect(refreshed.getAttribute("src")).toBe(currentRun.url);
  currentRun.state = "running";
  currentRun.errorMessage = "Waiting for preview: HTTP 503";
  await screen.findByText("Waiting for preview: HTTP 503", {}, { timeout: 2000 });
  expect(screen.queryByTitle("Browser preview App")).toBeNull();
});

test("same-address Go reloads arbitrary URLs and rejects non-http schemes", async () => {
  const user = userEvent.setup();
  render(<BrowserPane node={{ ...node, data: { url: "https://example.com/" } }} onSave={vi.fn()} />);
  const frame = screen.getByTitle("Browser preview App");
  await user.click(screen.getByRole("button", { name: "Go" }));
  expect(screen.getByTitle("Browser preview App")).not.toBe(frame);
  fireEvent.change(screen.getByLabelText("Browser address"), { target: { value: "file:///private" } });
  await user.click(screen.getByRole("button", { name: "Go" }));
  expect(screen.getByRole("alert").textContent).toContain("http or https");
  expect(screen.getByTitle("Browser preview App").getAttribute("src")).toBe("https://example.com/");
});

test("rerendering with a new save callback does not repeat lifecycle inspection", async () => {
  const mounted = render(<BrowserPane node={node} projectId="project" projectRoot="C:/repo" onSave={vi.fn()} />);
  await screen.findByRole("button", { name: "Start preview" });
  mounted.rerender(<BrowserPane node={{ ...node, data: { url: "https://example.com/" } }} projectId="project" projectRoot="C:/repo" onSave={vi.fn()} />);
  await waitFor(() => expect(core.callCore.mock.calls.filter(([method]) => method === "project_lifecycle_inspect")).toHaveLength(1));
});


test("normalizing a managed localhost address cannot bypass readiness", async () => {
  const user = userEvent.setup();
  currentRun.url = "http://127.0.0.1:4321";
  render(<BrowserPane node={node} projectId="project" projectRoot="C:/repo" onSave={vi.fn()} />);
  await user.click(await screen.findByRole("button", { name: "Start preview" }));
  await user.click(screen.getByRole("button", { name: "Go" }));
  expect((screen.getByLabelText("Browser address") as HTMLInputElement).value).toBe("http://127.0.0.1:4321/");
  expect(screen.queryByTitle("Browser preview App")).toBeNull();
  expect(screen.getByText("Starting preview. Waiting for the server…")).toBeTruthy();
});
