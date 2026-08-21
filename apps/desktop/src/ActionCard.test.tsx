import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ActionCard } from "./ActionCard";

describe("ActionCard", () => {
  test("renders an approval decision with secondary action before primary", () => {
    const approve = vi.fn();
    const deny = vi.fn();
    render(<ActionCard
      variant="decision"
      decisionType="approval"
      title="Permission requested"
      summary="Run the verification command"
      actions={[
        { id: "approve", label: "Approve", intent: "primary", onInvoke: approve },
        { id: "deny", label: "Deny", intent: "secondary", onInvoke: deny },
      ]}
    />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["Deny", "Approve"]);
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);
    expect(deny).toHaveBeenCalledOnce();
    expect(approve).toHaveBeenCalledOnce();
  });

  test("submits a question from Enter and preserves Shift+Enter", () => {
    const submit = vi.fn();
    const change = vi.fn();
    render(<ActionCard
      variant="decision"
      decisionType="question"
      title="Response needed"
      draft="Use the desktop path"
      onDraftChange={change}
      actions={[{ id: "send", label: "Send answer", intent: "primary", onInvoke: submit }]}
    />);
    const input = screen.getByRole("textbox", { name: "Answer the agent question" });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(submit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(submit).toHaveBeenCalledOnce();
    fireEvent.change(input, { target: { value: "Changed" } });
    expect(change).toHaveBeenCalledWith("Changed");
  });

  test("invokes a question choice without requiring the draft", () => {
    const choose = vi.fn();
    render(<ActionCard
      variant="decision"
      decisionType="question"
      title="Response needed"
      summary="How should I finish the real-machine QA?"
      choices={[{ id: "Authorize this SSH key", label: "Authorize this SSH key", description: "Add this host pubkey" }]}
      onChoice={choose}
    />);
    fireEvent.click(screen.getByRole("button", { name: "Authorize this SSH key" }));
    expect(choose).toHaveBeenCalledWith("Authorize this SSH key");
  });

  test("disables every action while one is pending", () => {
    render(<ActionCard
      variant="recovery"
      title="Agent failed"
      error="The adapter exited."
      actions={[
        { id: "logs", label: "Transcript", onInvoke: vi.fn() },
        { id: "retry", label: "Resume", intent: "primary", pending: true, onInvoke: vi.fn() },
      ]}
    />);
    expect(screen.getByRole("article").getAttribute("aria-busy")).toBe("true");
    for (const button of screen.getAllByRole<HTMLButtonElement>("button")) expect(button.disabled).toBe(true);
  });

  test("renders recommendation rationale and expandable evidence", () => {
    const { rerender } = render(<ActionCard
      variant="recommendation"
      title="Recommended next step"
      recommendation="Run verification"
      rationale="No current verification evidence exists."
    />);
    expect(screen.getByText("Run verification")).toBeTruthy();
    rerender(<ActionCard
      variant="evidence"
      title="Repository evidence"
      source="working tree"
      details={<pre>src/App.tsx</pre>}
    />);
    expect(screen.getByText("Source: working tree")).toBeTruthy();
    expect(screen.getByText("Show evidence")).toBeTruthy();
  });
});
