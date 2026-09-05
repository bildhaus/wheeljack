import { expect, test } from "vitest";
import { agentCompositionFromNode, nodeDataWithAgentComposition } from "./agentComposition";

test("normalizes durable per-agent composition state", () => {
  const state = agentCompositionFromNode({
    chatComposition: {
      version: 99,
      draft: "Continue the review",
      attachments: [
        { path: "attachments/review.png", fileName: "review.png", mimeType: "image/png" },
        { path: "attachments/nope.txt", fileName: "nope.txt", mimeType: "text/plain" },
      ],
      scrollTop: -12,
      followLatest: false,
    },
  });

  expect(state).toEqual({
    version: 1,
    draft: "Continue the review",
    attachments: [{ path: "attachments/review.png", fileName: "review.png", mimeType: "image/png" }],
    scrollTop: 0,
    followLatest: false,
  });
});

test("merges composition without replacing runtime node data", () => {
  const data = nodeDataWithAgentComposition(
    { sessionId: "session-1", status: "ready" },
    { version: 1, draft: "Draft", attachments: [], scrollTop: 420, followLatest: false },
  );

  expect(data.sessionId).toBe("session-1");
  expect(data.chatComposition).toMatchObject({ draft: "Draft", scrollTop: 420, followLatest: false });
});


test("queued edit normalization retains the unsent draft and validates its separate attachments", () => {
  const result = nodeDataWithAgentComposition({}, {
    version: 1, draft: "New prompt", attachments: [], scrollTop: 0, followLatest: true,
    queuedEdit: { deliveryId: "pending-one", draft: "Revised queued prompt", attachments: [{ path: "edit.png", fileName: "edit.png", mimeType: "image/png" }] },
  });
  expect(agentCompositionFromNode(result)).toMatchObject({
    draft: "New prompt", queuedEdit: { deliveryId: "pending-one", draft: "Revised queued prompt", attachments: [{ path: "edit.png" }] },
  });
});
