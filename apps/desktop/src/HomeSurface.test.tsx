import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import type { ComponentProps } from "react";
import { HomeSurface } from "./ParitySurfaces";
import type { Project } from "./types";

const alpha: Project = { id: "alpha", name: "Alpha", path: "C:/alpha", icon: "folder", iconColor: "#fff", agentAccess: "default", branch: "main", dirty: true, githubRemote: false, pathExists: true };
const beta: Project = { ...alpha, id: "beta", name: "Beta", path: "C:/beta", dirty: false };
function props(): ComponentProps<typeof HomeSurface> {
  return {
    projects: [alpha, beta], currentProject: alpha, sessions: [], activity: [], attention: [], loading: false,
    onOpen: vi.fn(), onProject: vi.fn(), onCustomize: vi.fn(), onRelink: vi.fn(), onSession: vi.fn(), onRemove: vi.fn(), onActivity: vi.fn(), onAttention: vi.fn(), onResearch: vi.fn(), onBootstrapPlan: vi.fn(), onTerminal: vi.fn(), onInbox: vi.fn(), onGit: vi.fn(),
    showRecentActivity: false, showAgentRail: false, showProjectPaths: true, agentReady: true,
    onAgentSettings: vi.fn(), bots: [], botActiveCount: 0, onBots: vi.fn(),
  };
}

test("Home quick starts identify their exact project and disable while no project is selected", async () => {
  const user = userEvent.setup();
  const callbacks = props();
  const mounted = render(<HomeSurface {...callbacks} />);
  await user.click(screen.getByRole("button", { name: /Research Alpha/ }));
  expect(callbacks.onResearch).toHaveBeenCalledOnce();
  mounted.rerender(<HomeSurface {...callbacks} currentProject={beta} />);
  expect(screen.getByRole("button", { name: /Bootstrap plan for Beta/ })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Research Alpha/ })).toBeNull();
  mounted.rerender(<HomeSurface {...callbacks} currentProject={undefined} />);
  expect((screen.getByRole("button", { name: /Research a project/ }) as HTMLButtonElement).disabled).toBe(true);
});

test("Home reports dirty projects consistently and includes task-worktree agents by ownership", () => {
  const callbacks = props();
  const session = { id: "session", nodeId: "agent", adapterId: "codex-cli", cwd: "C:/separate-worktree", projectId: "alpha", status: "running", startedAt: "" };
  render(<HomeSurface {...callbacks} sessions={[session]} git={{ isRepo: true, pathExists: true, dirty: true, githubRemote: false, worktrees: [], branch: "main", changedFiles: ["a", "b", "c"] }} />);
  const metric = screen.getByText("Dirty projects").parentElement!;
  expect(metric.textContent).toContain("1");
  expect(screen.queryByText("Changed files")).toBeNull();
  const alphaRow = screen.getByText("Alpha").closest("article")!;
  expect(within(alphaRow).getByText("1 running")).toBeTruthy();
  expect(within(screen.getByText("Beta").closest("article")!).getByText("0 running")).toBeTruthy();
});
