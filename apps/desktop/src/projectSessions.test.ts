import { sessionBelongsToProject } from "./projectSessions";

const project = { id: "one", path: "C:\\repo" };

test("session ownership includes external task worktrees without claiming another project", () => {
  expect(sessionBelongsToProject({ projectId: "one", cwd: "C:\\worktrees\\task" }, project)).toBe(true);
  expect(sessionBelongsToProject({ projectId: "two", cwd: project.path }, project)).toBe(false);
  expect(sessionBelongsToProject({ cwd: project.path }, project)).toBe(true);
  expect(sessionBelongsToProject({ cwd: "C:\\repository" }, project)).toBe(false);
});
