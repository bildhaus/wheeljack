import type { Project, Session } from "./types";
import { workspacePathsEqual } from "./opsOrchestration";

export function sessionBelongsToProject(session: Pick<Session, "projectId" | "cwd">, project: Pick<Project, "id" | "path">): boolean {
  return session.projectId ? session.projectId === project.id : workspacePathsEqual(session.cwd, project.path);
}
