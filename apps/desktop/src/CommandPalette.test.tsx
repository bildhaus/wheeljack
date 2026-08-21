import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommandPalette, filterCommandPaletteItems, moveCommandPaletteSelection, type CommandPaletteItem } from "./CommandPalette";

test("filters command labels, groups, and keywords without a fuzzy-search dependency", () => {
  const items: CommandPaletteItem[] = [
    { id: "work", group: "Navigate", label: "Open Work", keywords: ["terminal", "shell"], onSelect() {} },
    { id: "inbox", group: "Utilities", label: "Open Inbox", onSelect() {} },
  ];
  expect(filterCommandPaletteItems(items, "terminal").map((item) => item.id)).toEqual(["work"]);
  expect(filterCommandPaletteItems(items, "utilities inbox").map((item) => item.id)).toEqual(["inbox"]);
  expect(filterCommandPaletteItems(items, "missing")).toEqual([]);
});

test("wraps keyboard selection across the available commands", () => {
  expect(moveCommandPaletteSelection(0, 3, -1)).toBe(2);
  expect(moveCommandPaletteSelection(2, 3, 1)).toBe(0);
  expect(moveCommandPaletteSelection(0, 0, 1)).toBe(0);
});

function paletteItems(onSelect: Record<string, () => void> = {}): CommandPaletteItem[] {
  return [
    { id: "work", group: "Navigate", label: "Open Work", keywords: ["terminal"], onSelect: onSelect.work ?? (() => {}) },
    { id: "plan", group: "Navigate", label: "Open Plan", onSelect: onSelect.plan ?? (() => {}) },
    { id: "inbox", group: "Utilities", label: "Open Inbox", onSelect: onSelect.inbox ?? (() => {}) },
  ];
}

test("groups commands and marks the first as active on open", () => {
  render(<CommandPalette open items={paletteItems()} shortcut="Ctrl+K" onOpenChange={() => {}} />);

  const groups = screen.getAllByRole("group");
  expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual(["Navigate", "Utilities"]);
  expect(within(groups[0]).getAllByRole("option").map((option) => option.textContent)).toEqual(["Open Work", "Open Plan"]);

  const combobox = screen.getByRole("combobox", { name: "Search commands" });
  expect(screen.getByRole("option", { name: "Open Work" }).getAttribute("aria-selected")).toBe("true");
  expect(combobox.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: "Open Work" }).id);
});

test("moves the active option with the arrow keys and wraps at the end", async () => {
  const user = userEvent.setup();
  render(<CommandPalette open items={paletteItems()} shortcut="Ctrl+K" onOpenChange={() => {}} />);
  const combobox = screen.getByRole("combobox", { name: "Search commands" });
  combobox.focus();

  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("option", { name: "Open Plan" }).getAttribute("aria-selected")).toBe("true");

  await user.keyboard("{ArrowDown}{ArrowDown}");
  expect(screen.getByRole("option", { name: "Open Work" }).getAttribute("aria-selected")).toBe("true");

  await user.keyboard("{ArrowUp}");
  expect(screen.getByRole("option", { name: "Open Inbox" }).getAttribute("aria-selected")).toBe("true");
});

test("runs the active command on Enter and closes the palette", async () => {
  const user = userEvent.setup();
  const ran: string[] = [];
  const openChanges: boolean[] = [];
  render(
    <CommandPalette
      open
      items={paletteItems({ plan: () => ran.push("plan") })}
      shortcut="Ctrl+K"
      onOpenChange={(open) => openChanges.push(open)}
    />,
  );
  screen.getByRole("combobox", { name: "Search commands" }).focus();

  await user.keyboard("{ArrowDown}{Enter}");

  expect(ran).toEqual(["plan"]);
  expect(openChanges).toEqual([false]);
});

test("narrows the list as the query changes and resets the active option", async () => {
  const user = userEvent.setup();
  const ran: string[] = [];
  render(
    <CommandPalette
      open
      items={paletteItems({ inbox: () => ran.push("inbox") })}
      shortcut="Ctrl+K"
      onOpenChange={() => {}}
    />,
  );
  const combobox = screen.getByRole("combobox", { name: "Search commands" });

  await user.click(combobox);
  await user.keyboard("{ArrowDown}");
  await user.type(combobox, "inbox");

  const options = screen.getAllByRole("option");
  expect(options.map((option) => option.textContent)).toEqual(["Open Inbox"]);
  expect(options[0].getAttribute("aria-selected")).toBe("true");

  await user.keyboard("{Enter}");
  expect(ran).toEqual(["inbox"]);
});

test("reports an empty result instead of rendering a blank list", async () => {
  const user = userEvent.setup();
  render(<CommandPalette open items={paletteItems()} shortcut="Ctrl+K" onOpenChange={() => {}} />);

  await user.type(screen.getByRole("combobox", { name: "Search commands" }), "nothing matches");

  expect(screen.queryAllByRole("option")).toHaveLength(0);
  expect(screen.getByRole("status").textContent).toBe("No matching commands");
});
