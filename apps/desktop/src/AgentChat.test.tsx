import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { vi } from "vitest";
import { AgentChat, AgentMessageContent, parseAgentMessageBlocks } from "./AgentChat";
import { agentModelCacheKey } from "./agentModels";
import { defaultShortcutBindings } from "./shortcuts";
import type { AgentMessage, AgentProfile, PaneRuntime } from "./types";

const coreMocks = vi.hoisted(() => ({
  callCore: vi.fn(),
  importImageAttachment: vi.fn(),
  readImageAttachment: vi.fn(),
  saveImageAttachment: vi.fn(),
}));

vi.mock("./core", () => coreMocks);
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));

const profile: AgentProfile = {
  adapterId: "codex-cli",
  provider: "openai",
  model: "gpt-5.4-mini",
  thinking: "medium",
  approvalPolicy: "on-request",
};

function runtime(overrides: Partial<PaneRuntime> = {}): PaneRuntime {
  return {
    nodeId: "agent-one",
    sessionId: "session-one",
    historySessionId: "history-one",
    adapterId: "codex-cli",
    structured: true,
    protocol: "codex-app-server",
    capabilities: { cancel: true, interact: true, resume: true, attachedTerminal: false, imageInput: true },
    status: "ready",
    transcript: "",
    structuredLines: [],
    messages: [],
    ...overrides,
  };
}

function actions() {
  return {
    onPrompt: vi.fn(async () => true),
    onPromptEdit: vi.fn(async () => true),
    onPromptRetry: vi.fn(async () => true),
    onPromptCancel: vi.fn(async () => true),
    onRespond: vi.fn(async () => true),
    onCancel: vi.fn(async () => true),
    onLoadOlderHistory: vi.fn(async () => undefined),
    onAgentAccess: vi.fn(async () => undefined),
    onAgentProfile: vi.fn(),
    onRepair: vi.fn(),
    onResume: vi.fn(),
  };
}

function renderChat(
  runtimeOverrides: Partial<PaneRuntime> = {},
  propOverrides: Partial<ComponentProps<typeof AgentChat>> = {},
) {
  const callbacks = actions();
  const props: ComponentProps<typeof AgentChat> = {
    autoFocusComposer: false,
    runtime: runtime(runtimeOverrides),
    projectRoot: "C:\\repo",
    agentAccess: "default",
    shortcuts: defaultShortcutBindings,
    ...callbacks,
    ...propOverrides,
  };
  return { ...render(<AgentChat {...props} />), callbacks, props };
}

test("renders the empty lifecycle and submits an accepted prompt", async () => {
  const user = userEvent.setup();
  const { callbacks } = renderChat({}, { autoFocusComposer: true });

  expect(screen.getByLabelText("Agent conversation")).toBeTruthy();
  expect(screen.getByText("What should this agent work on?")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Attach images" }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByRole("button", { name: "Project agent access: Agent default" })).toBeTruthy();

  const composer = screen.getByRole("textbox", { name: "Agent prompt" });
  expect(document.activeElement).toBe(composer);
  await user.type(composer, "Inspect the repository{Enter}");

  await waitFor(() => expect(callbacks.onPrompt).toHaveBeenCalledWith("Inspect the repository", []));
  expect((composer as HTMLTextAreaElement).value).toBe("");
});

test("answers a labeled OpenCode question from a choice button", async () => {
  const user = userEvent.setup();
  const question: AgentMessage = {
    id: "question-one",
    role: "system",
    kind: "question",
    title: "Mac access",
    text: "How should I finish the real-machine QA?",
    interactionId: "interaction-one",
    interactionState: "pending",
    choices: [{ id: "Authorize this SSH key", label: "Authorize this SSH key", description: "Add this host pubkey" }],
  };
  const { callbacks } = renderChat({ status: "needs_input", messages: [question] });
  await user.click(screen.getByRole("button", { name: "Authorize this SSH key" }));
  await waitFor(() => expect(callbacks.onRespond).toHaveBeenCalledWith(true, "Authorize this SSH key"));
});

test("restores and publishes the per-agent draft", async () => {
  const user = userEvent.setup();
  const onCompositionChange = vi.fn();
  renderChat({}, {
    composition: {
      version: 1,
      draft: "Review the",
      attachments: [],
      scrollTop: 240,
      followLatest: false,
    },
    onCompositionChange,
  });

  const composer = screen.getByRole("textbox", { name: "Agent prompt" });
  expect((composer as HTMLTextAreaElement).value).toBe("Review the");
  await user.type(composer, " runtime");

  await waitFor(() => expect(onCompositionChange).toHaveBeenLastCalledWith(expect.objectContaining({
    draft: "Review the runtime",
    attachments: [],
    scrollTop: 240,
    followLatest: false,
  })));
});

test("keeps the active turn visible and makes stop a distinct action", async () => {
  const user = userEvent.setup();
  const { callbacks } = renderChat({
    status: "running",
    messages: [{ id: "answer", role: "assistant", kind: "message", text: "Working", streaming: true }],
  });

  expect(screen.getByText("Working")).toBeTruthy();
  expect(screen.queryByText("What should this agent work on?")).toBeNull();
  const stop = screen.getByRole("button", { name: "Stop agent turn" });
  expect(stop.querySelector('[data-sargam-icon="stop"]')).not.toBeNull();
  await user.click(stop);
  expect(callbacks.onCancel).toHaveBeenCalledOnce();

  const composer = screen.getByRole("textbox", { name: "Agent prompt" });
  await user.type(composer, "Check the tests next{Enter}");
  await waitFor(() => expect(callbacks.onPrompt).toHaveBeenCalledWith("Check the tests next", []));
  expect(screen.getByRole("button", { name: "Queue prompt" })).toBeTruthy();
});

test("shows durable prompt recovery actions", async () => {
  const user = userEvent.setup();
  const { callbacks } = renderChat({
    promptDeliveries: [{
      id: "delivery-one",
      sessionId: "session-one",
      seq: 2,
      mode: "next",
      state: "indeterminate",
      payload: { prompt: "Check again", historyText: "Check again", imagePaths: [] },
      revision: 1,
      attempts: 1,
      errorMessage: "Delivery could not be confirmed.",
      createdAt: "2026-08-28T00:00:00Z",
      updatedAt: "2026-08-28T00:00:01Z",
    }],
  });
  expect(screen.getByText("Delivery could not be confirmed.")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(callbacks.onPromptRetry).toHaveBeenCalledWith(expect.objectContaining({ id: "delivery-one" }));
});

test("edits a queued prompt atomically and preserves its images", async () => {
  const user = userEvent.setup();
  coreMocks.readImageAttachment.mockResolvedValue({ dataUrl: "data:image/png;base64,AA==" });
  const attachment = { path: "C:\\data\\queued.png", fileName: "queued.png", mimeType: "image/png" };
  const delivery = {
    id: "delivery-edit",
    sessionId: "session-one",
    seq: 3,
    mode: "next" as const,
    state: "queued" as const,
    payload: { prompt: "Old prompt", historyText: "Old prompt", imagePaths: [attachment.path] },
    revision: 1,
    attempts: 0,
    createdAt: "2026-08-28T00:00:00Z",
    updatedAt: "2026-08-28T00:00:00Z",
  };
  const { callbacks } = renderChat({
    status: "running",
    promptDeliveries: [delivery],
    messages: [{ id: "queued-user", role: "user", kind: "message", text: "Old prompt", images: [attachment], deliveryId: delivery.id, deliveryState: "queued" }],
  });

  await user.click(screen.getByRole("button", { name: "Edit" }));
  const composer = screen.getByRole("textbox", { name: "Agent prompt" });
  expect((composer as HTMLTextAreaElement).value).toBe("Old prompt");
  expect(screen.getByRole("button", { name: "Remove queued.png" })).toBeTruthy();
  await user.clear(composer);
  await user.type(composer, "Updated prompt{Enter}");

  await waitFor(() => expect(callbacks.onPromptEdit).toHaveBeenCalledWith(delivery, "Updated prompt", [attachment]));
  expect((composer as HTMLTextAreaElement).value).toBe("");
});

test("uses the latest progress update instead of a generic working fallback", () => {
  renderChat({
    status: "running",
    messages: [
      { id: "reasoning-old", role: "system", kind: "reasoning", text: "Earlier thought", streaming: true },
      { id: "answer-current", role: "assistant", kind: "message", text: "Waiting for the next provider event", streaming: false },
    ],
  });

  expect(screen.getByText("Waiting for the next provider event")).toBeTruthy();
  expect(screen.queryByText("Agent is working…")).toBeNull();
});

test("answers a blocking question once inline and locks the normal composer", async () => {
  const user = userEvent.setup();
  const question: AgentMessage = {
    id: "question-one",
    role: "system",
    kind: "question",
    text: "Which target?",
    interactionId: "interaction-one",
    interactionState: "pending",
  };
  const { callbacks } = renderChat({ status: "needs_input", messages: [question] });

  expect(screen.getAllByText("Response needed")).toHaveLength(1);
  expect(screen.queryByRole("textbox", { name: "Agent prompt" })).toBeNull();
  const composer = screen.getByRole("textbox", { name: "Answer the agent question" });
  const send = screen.getAllByRole("button", { name: "Send answer" })[0];
  expect((send as HTMLButtonElement).disabled).toBe(true);
  await user.type(composer, "Windows and macOS");
  await user.click(send);

  await waitFor(() => expect(callbacks.onRespond).toHaveBeenCalledWith(true, "Windows and macOS"));
  expect((composer as HTMLTextAreaElement).value).toBe("");
});

test("preserves approval outcomes as explicit transcript actions", async () => {
  const user = userEvent.setup();
  const approval: AgentMessage = {
    id: "approval-one",
    role: "system",
    kind: "approval",
    title: "Run tests",
    text: "Allow cargo test?",
    interactionId: "interaction-one",
    interactionState: "pending",
  };
  const { callbacks } = renderChat({ status: "needs_input", messages: [approval] });

  expect(screen.getByText("Permission requested")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Deny" }));
  expect(callbacks.onRespond).toHaveBeenCalledWith(false, undefined);
});

test("shows recovery actions for authentication failures", async () => {
  const user = userEvent.setup();
  const { callbacks } = renderChat({ status: "failed", statusSummary: "Authentication required" });

  expect(screen.queryByRole("textbox", { name: "Agent prompt" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Repair sign-in" }));
  await user.click(screen.getByRole("button", { name: "Resume" }));
  expect(callbacks.onRepair).toHaveBeenCalledOnce();
  expect(callbacks.onResume).toHaveBeenCalledOnce();
});

test("groups turn activity, keeps live identity compact, and preserves disclosure state", async () => {
  const user = userEvent.setup();
  const messages: AgentMessage[] = [
    { id: "tool-one", role: "system", kind: "tool", text: "first", tool: "Read" },
    { id: "tool-two", role: "system", kind: "tool", text: "second", tool: "Search" },
    { id: "reasoning", role: "assistant", kind: "reasoning", text: "Check the boundary" },
  ];
  const { rerender, props } = renderChat({ status: "completed", messages });

  const toolActivity = screen.getByRole("button", { name: /Activity.*2 tools used.*Completed/i });
  expect(toolActivity.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText("Source: agent tools")).toBeNull();
  await user.click(toolActivity);
  expect(toolActivity.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByText("Check the boundary")).toBeTruthy();
  expect(screen.getAllByRole("button", { name: /Activity/i })).toHaveLength(1);

  rerender(<AgentChat {...props} runtime={runtime({
    status: "running",
    messages: [{ id: "tool-live", role: "system", kind: "tool", text: "reading", tool: "Read file", streaming: true }],
  })} />);
  const liveTool = screen.getByRole("button", { name: /Read file.*1 tool used.*Running/i });
  expect(liveTool.getAttribute("aria-expanded")).toBe("false");
  await user.click(liveTool);
  expect(liveTool.getAttribute("aria-expanded")).toBe("true");

  rerender(<AgentChat {...props} runtime={runtime({
    status: "running",
    messages: [{ id: "tool-live", role: "system", kind: "tool", text: "read", tool: "Read file", streaming: false }],
  })} />);
  const completedTool = screen.getByRole("button", { name: /Working.*1 tool used.*Running/i });
  expect(completedTool.getAttribute("aria-expanded")).toBe("true");
  await user.click(completedTool);
  expect(completedTool.getAttribute("aria-expanded")).toBe("false");

  rerender(<AgentChat {...props} runtime={runtime({
    status: "running",
    messages: [
      { id: "tool-live", role: "system", kind: "tool", text: "read", tool: "Read file", streaming: false },
      { id: "tool-next", role: "system", kind: "tool", text: "searching", tool: "Search files", streaming: true },
    ],
  })} />);
  expect(screen.getByRole("button", { name: /Search files.*2 tools used.*Running/i }).getAttribute("aria-expanded")).toBe("false");
});

test("keeps live reasoning compact within the turn activity disclosure", async () => {
  const user = userEvent.setup();
  const { rerender, props } = renderChat({
    status: "running",
    messages: [{ id: "reasoning-live", role: "assistant", kind: "reasoning", text: "Checking", streaming: true }],
  });

  const liveReasoning = screen.getByRole("button", { name: /Thinking….*Running/i });
  expect(liveReasoning.getAttribute("aria-expanded")).toBe("false");

  rerender(<AgentChat {...props} runtime={runtime({
    status: "running",
    messages: [{ id: "reasoning-live", role: "assistant", kind: "reasoning", text: "Checked", streaming: false }],
  })} />);
  const completedReasoning = screen.getByRole("button", { name: /Working.*Running/i });
  expect(completedReasoning.getAttribute("aria-expanded")).toBe("false");
  await user.click(completedReasoning);
  expect(completedReasoning.getAttribute("aria-expanded")).toBe("true");
});

test("starts new live activity after an interim assistant response", () => {
  renderChat({
    status: "running",
    messages: [
      { id: "tool-one", role: "system", kind: "tool", text: "main.rs", tool: "Read" },
      { id: "progress", role: "assistant", kind: "message", text: "I’ll inspect the command boundary next." },
      { id: "tool-two", role: "system", kind: "tool", text: "tests", tool: "Search", streaming: true },
    ],
  });

  const activities = screen.getAllByRole("button", { name: /1 tool used/i });
  expect(activities).toHaveLength(2);
  expect(activities[0].getAttribute("aria-label") ?? activities[0].textContent).toMatch(/Activity/i);
  expect(activities[1].getAttribute("aria-label") ?? activities[1].textContent).toMatch(/Search/i);
  expect(screen.getByText("I’ll inspect the command boundary next.").closest('[data-chat-part="answer"]')).not.toBeNull();
});

test("collapses interim assistant responses into completed turn activity", async () => {
  const user = userEvent.setup();
  renderChat({
    status: "completed",
    messages: [
      { id: "reasoning-one", role: "system", kind: "reasoning", text: "Read the task" },
      { id: "progress-one", role: "assistant", kind: "message", text: "I’ll inspect the command boundary next." },
      { id: "tool-one", role: "system", kind: "tool", text: "main.rs", tool: "Read" },
      { id: "reasoning-two", role: "system", kind: "reasoning", text: "Compare signatures" },
      { id: "progress-two", role: "assistant", kind: "message", text: "The decoder contract is the blocker." },
      { id: "tool-two", role: "system", kind: "tool", text: "tests", tool: "Search" },
      { id: "tool-three", role: "system", kind: "tool", text: "green", tool: "Test" },
      { id: "answer", role: "assistant", kind: "message", text: "Implemented the decoder-boundary coverage." },
    ],
  });

  const firstUpdate = screen.getByText("I’ll inspect the command boundary next.");
  const secondUpdate = screen.getByText("The decoder contract is the blocker.");
  expect(firstUpdate.closest('[data-chat-part="activity"]')).not.toBeNull();
  expect(secondUpdate.closest('[data-chat-part="activity"]')).not.toBeNull();
  const activity = screen.getByRole("button", { name: /Activity.*3 tools used.*2 updates.*Completed/i });
  expect(activity.getAttribute("aria-expanded")).toBe("false");
  expect(screen.getAllByRole("button", { name: /Activity/i })).toHaveLength(1);
  expect(screen.getByText("Implemented the decoder-boundary coverage.").closest('[data-chat-part="answer"]')).not.toBeNull();
  await user.click(activity);
  expect(screen.getByText("Read the task")).toBeTruthy();
  expect(screen.getByText("Compare signatures")).toBeTruthy();
});

test("loads durable earlier history on demand", async () => {
  const user = userEvent.setup();
  const { callbacks } = renderChat({ historyHasMore: true });

  await user.click(screen.getByRole("button", { name: "Load earlier messages" }));
  await waitFor(() => expect(callbacks.onLoadOlderHistory).toHaveBeenCalledOnce());
});

test("lists project files and inserts the keyboard-selected mention", async () => {
  const user = userEvent.setup();
  coreMocks.callCore.mockResolvedValueOnce({ files: ["src/App.tsx", "src/AgentChat.tsx"], truncated: false });
  renderChat();

  const composer = screen.getByRole("textbox", { name: "Agent prompt" });
  await user.type(composer, "Review @App");
  const listbox = await screen.findByRole("listbox", { name: "Project context" });
  expect(listbox).toBeTruthy();
  fireEvent.keyDown(composer, { key: "Enter" });
  expect((composer as HTMLTextAreaElement).value).toBe("Review @src/App.tsx ");
});

test("lists excluded plan files as wheeljack documents", async () => {
  const user = userEvent.setup();
  coreMocks.callCore.mockResolvedValueOnce({
    files: ["src/App.tsx"],
    wheeljackDocuments: ["KANBAN.md", "PRD.md", "TDD.md"],
    truncated: false,
  });
  renderChat();

  const composer = screen.getByRole("textbox", { name: "Agent prompt" });
  await user.type(composer, "Recreate @kanban");
  expect(await screen.findByRole("group", { name: "wheeljack documents" })).toBeTruthy();
  expect(screen.queryByRole("group", { name: "Project files" })).toBeNull();
  fireEvent.keyDown(composer, { key: "Enter" });
  expect((composer as HTMLTextAreaElement).value).toBe("Recreate @KANBAN.md ");
});

test("discovers cached models and commits the selected profile", async () => {
  const user = userEvent.setup();
  const catalog = {
    models: [
      { id: "gpt-5.4-mini", label: "GPT-5.4 mini", provider: "openai", efforts: ["low", "medium", "high"] },
      { id: "gpt-5.6", label: "GPT-5.6", provider: "openai", efforts: ["medium", "high"], defaultEffort: "high" },
    ],
  };
  localStorage.setItem(agentModelCacheKey(profile.adapterId, "C:\\repo"), JSON.stringify({ updatedAt: Date.now(), catalog }));
  const { callbacks } = renderChat({}, { agentProfile: profile });

  await user.click(screen.getByRole("button", { name: /Model: gpt-5.4-mini/ }));
  const search = await screen.findByRole("combobox", { name: "Search agent models" });
  await user.type(search, "GPT-5.6");
  await user.keyboard("{Enter}");
  await user.click(screen.getByRole("button", { name: "Apply" }));

  expect(callbacks.onAgentProfile).toHaveBeenCalledWith("codex-cli", {
    model: "gpt-5.6",
    provider: "openai",
    thinking: "medium",
  });
});

test("exports a memoized chat boundary", () => {
  expect(AgentChat).toHaveProperty("$$typeof", Symbol.for("react.memo"));
});

test("renders fenced code and sanitizes rich agent output", () => {
  expect(parseAgentMessageBlocks("Use `cargo test`.\n```rust\nassert!(true);\n```\nDone.")).toEqual([
    { kind: "text", text: "Use `cargo test`.\n" },
    { kind: "code", text: "assert!(true);\n", language: "rust" },
    { kind: "text", text: "\nDone." },
  ]);

  const { container, rerender } = render(<AgentMessageContent text={"## Run\n\n- First\n- Second\n\n[Docs](https://example.com) are **ready**."} />);
  expect(screen.getByRole("heading", { name: "Run" })).toBeTruthy();
  expect(screen.getByRole("list").children).toHaveLength(2);
  const link = screen.getByRole("link", { name: "Docs" });
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toBe("noreferrer");

  rerender(<AgentMessageContent text={"<script>alert(1)</script>\n\nSafe"} />);
  expect(container.querySelector("script")).toBeNull();
  expect(screen.getByText("Safe")).toBeTruthy();
});


function queuedDelivery() {
  return {
    id: "queued-edit-restore", sessionId: "session-one", seq: 9, mode: "next" as const,
    state: "queued" as const, payload: { prompt: "Queued instruction", historyText: "Queued instruction", imagePaths: [] },
    revision: 1, attempts: 0, createdAt: "2026-09-05T00:00:00Z", updatedAt: "2026-09-05T00:00:00Z",
  };
}

test("canceling or saving a queued edit restores the unrelated draft and attachments", async () => {
  const user = userEvent.setup();
  const attachment = { path: "draft.png", fileName: "draft.png", mimeType: "image/png" };
  coreMocks.readImageAttachment.mockResolvedValue({ dataUrl: "data:image/png;base64,AA==" });
  const delivery = queuedDelivery();
  const { callbacks } = renderChat({ status: "running", promptDeliveries: [delivery] }, {
    composition: { version: 1, draft: "My next instruction", attachments: [attachment], scrollTop: 0, followLatest: true },
  });
  await user.click(screen.getByRole("button", { name: "Edit" }));
  expect((screen.getByLabelText("Agent prompt") as HTMLTextAreaElement).value).toBe("Queued instruction");
  await user.click(screen.getByRole("button", { name: "Stop editing" }));
  expect((screen.getByLabelText("Agent prompt") as HTMLTextAreaElement).value).toBe("My next instruction");
  expect(screen.getByRole("button", { name: "Remove draft.png" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Edit" }));
  await user.type(screen.getByLabelText("Agent prompt"), " updated{Enter}");
  await waitFor(() => expect(callbacks.onPromptEdit).toHaveBeenCalledWith(delivery, "Queued instruction updated", []));
  expect((screen.getByLabelText("Agent prompt") as HTMLTextAreaElement).value).toBe("My next instruction");
  expect(screen.getByRole("button", { name: "Remove draft.png" })).toBeTruthy();
  expect(callbacks.onPrompt).not.toHaveBeenCalled();
});

test("remounting during a queued edit restores its identity instead of sending a duplicate", async () => {
  const user = userEvent.setup();
  const delivery = queuedDelivery();
  const onCompositionChange = vi.fn();
  const mounted = renderChat({ status: "running", promptDeliveries: [delivery] }, {
    composition: { version: 1, draft: "Unsent next prompt", attachments: [], scrollTop: 0, followLatest: true },
    onCompositionChange,
  });
  await user.click(screen.getByRole("button", { name: "Edit" }));
  await user.type(screen.getByLabelText("Agent prompt"), " revised");
  mounted.unmount();
  const saved = onCompositionChange.mock.lastCall![0];
  expect(saved.draft).toBe("Unsent next prompt");
  expect(saved.queuedEdit).toMatchObject({ deliveryId: delivery.id, draft: "Queued instruction revised" });
  const remounted = renderChat({ status: "running", promptDeliveries: [delivery] }, { composition: saved });
  expect(screen.getByText("Editing queued prompt")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Save queued prompt" }));
  await waitFor(() => expect(remounted.callbacks.onPromptEdit).toHaveBeenCalledWith(delivery, "Queued instruction revised", []));
  expect(remounted.callbacks.onPrompt).not.toHaveBeenCalled();
  expect((screen.getByLabelText("Agent prompt") as HTMLTextAreaElement).value).toBe("Unsent next prompt");
});

test("an edit survives queue loading and restores the draft when the delivery disappears", async () => {
  const delivery = queuedDelivery();
  const mounted = renderChat({ status: "running", promptDeliveries: undefined }, {
    composition: { version: 1, draft: "Unsent", attachments: [], scrollTop: 0, followLatest: true,
      queuedEdit: { deliveryId: delivery.id, draft: "Editing", attachments: [] } },
  });
  expect(screen.getByText("Editing queued prompt")).toBeTruthy();
  mounted.rerender(<AgentChat {...mounted.props} runtime={runtime({ status: "running", promptDeliveries: [] })} />);
  await waitFor(() => expect((screen.getByLabelText("Agent prompt") as HTMLTextAreaElement).value).toBe("Unsent"));
  expect(screen.queryByText("Editing queued prompt")).toBeNull();
  expect(mounted.callbacks.onPrompt).not.toHaveBeenCalled();
});


test("model Apply retains the editor when the pane configuration cannot be saved", async () => {
  const user = userEvent.setup();
  localStorage.clear();
  coreMocks.callCore.mockResolvedValue({ models: [{ id: profile.model, label: "Current model", efforts: ["medium"] }] });
  const onAgentProfile = vi.fn(async () => { throw new Error("Configuration could not be saved"); });
  renderChat({}, { agentProfile: profile, onAgentProfile });
  await user.click(screen.getByRole("button", { name: `Model: ${profile.model}, reasoning effort: medium` }));
  await screen.findByRole("option", { name: "Current model" });
  await user.click(screen.getByRole("button", { name: "Apply" }));
  expect(await screen.findByText("Configuration could not be saved")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Apply" })).toBeTruthy();
  expect(onAgentProfile).toHaveBeenCalledOnce();
});
