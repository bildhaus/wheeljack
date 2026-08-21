import { activeProjectFileMention, filterProjectFiles, insertProjectFileMention, projectFileParts } from "./agentFileMentions";

test("detects a project-file mention at the composer caret", () => {
  expect(activeProjectFileMention("Review @src/App", 15)).toEqual({ start: 7, end: 15, query: "src/App" });
  expect(activeProjectFileMention("mail@example.com", 16)).toBeUndefined();
  expect(activeProjectFileMention("Review @src/App today", 21)).toBeUndefined();
});

test("ranks basename, path, and fuzzy project-file matches", () => {
  const files = [
    "apps/desktop/src/App.tsx",
    "apps/desktop/src/agentFileMentions.ts",
    "crates/wheeljack-core/src/lib.rs",
  ];
  expect(filterProjectFiles(files, "App")[0]).toBe("apps/desktop/src/App.tsx");
  expect(filterProjectFiles(files, "afm")).toEqual(["apps/desktop/src/agentFileMentions.ts"]);
  expect(filterProjectFiles(files, "wheeljack")).toEqual(["crates/wheeljack-core/src/lib.rs"]);
});

test("inserts durable relative mentions and quotes paths containing spaces", () => {
  expect(insertProjectFileMention("Review @App", { start: 7, end: 11, query: "App" }, "src/App.tsx")).toEqual({
    value: "Review @src/App.tsx ",
    caret: 20,
  });
  expect(insertProjectFileMention("Use @notes", { start: 4, end: 10, query: "notes" }, "docs/release notes.md").value).toBe('Use @"docs/release notes.md" ');
});

test("splits project file labels into name and directory", () => {
  expect(projectFileParts("apps/desktop/src/App.tsx")).toEqual({ name: "App.tsx", directory: "apps/desktop/src" });
  expect(projectFileParts("README.md")).toEqual({ name: "README.md", directory: "Project root" });
});
