import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Dialog } from "radix-ui";
import { Search } from "./SargamIcon";

export interface CommandPaletteItem {
  id: string;
  group: string;
  label: string;
  keywords?: string[];
  icon?: ReactNode;
  onSelect: () => void;
}

export function filterCommandPaletteItems(items: CommandPaletteItem[], query: string): CommandPaletteItem[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return items;
  return items.filter((item) => {
    const text = [item.label, item.group, ...(item.keywords ?? [])].join(" ").toLowerCase();
    return terms.every((term) => text.includes(term));
  });
}

export function moveCommandPaletteSelection(index: number, count: number, delta: number): number {
  return count === 0 ? 0 : (index + delta + count) % count;
}

export function CommandPalette({
  open,
  items,
  shortcut,
  onOpenChange,
}: {
  open: boolean;
  items: CommandPaletteItem[];
  shortcut: string;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const listboxId = useId();
  const visibleItems = useMemo(() => filterCommandPaletteItems(items, query), [items, query]);
  const groups = useMemo(() => visibleItems.reduce<Array<{ name: string; items: Array<{ item: CommandPaletteItem; index: number }> }>>((result, item, index) => {
    const group = result.at(-1);
    if (group?.name === item.group) group.items.push({ item, index });
    else result.push({ name: item.group, items: [{ item, index }] });
    return result;
  }, []), [visibleItems]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
  }, [open]);

  useEffect(() => {
    if (activeIndex >= visibleItems.length) setActiveIndex(0);
  }, [activeIndex, visibleItems.length]);

  useEffect(() => {
    const item = visibleItems[activeIndex];
    if (open && item) document.getElementById(`${listboxId}-${item.id}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, listboxId, open, visibleItems]);

  const run = (item: CommandPaletteItem) => {
    onOpenChange(false);
    item.onSelect();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => moveCommandPaletteSelection(current, visibleItems.length, event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Enter" && visibleItems[activeIndex]) {
      event.preventDefault();
      run(visibleItems[activeIndex]);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay data-slot="command-palette-overlay" className="fixed inset-0 z-50 bg-black/45 supports-backdrop-filter:backdrop-blur-[2px] data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 motion-reduce:animate-none" />
        <Dialog.Content
          data-slot="command-palette-content"
          className="fixed top-[18vh] left-1/2 z-50 flex max-h-[min(560px,70vh)] w-[min(620px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-[var(--wj-shadow)] ring-1 ring-foreground/10 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 motion-reduce:animate-none"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            inputRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = returnFocusRef.current;
            returnFocusRef.current = null;
            if (target?.isConnected) target.focus();
          }}
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Dialog.Description className="sr-only">Search wheeljack actions and press Enter to run one.</Dialog.Description>
          <div className="flex items-center gap-3 border-b px-4">
            <Search className="text-muted-foreground" />
            <input
              ref={inputRef}
              role="combobox"
              aria-label="Search commands"
              aria-autocomplete="list"
              aria-controls={listboxId}
              aria-expanded="true"
              aria-activedescendant={visibleItems[activeIndex] ? `${listboxId}-${visibleItems[activeIndex].id}` : undefined}
              className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={onKeyDown}
              placeholder="Search commands"
            />
            <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{shortcut}</kbd>
          </div>
          <div id={listboxId} role="listbox" aria-label="Commands" className="min-h-0 flex-1 overflow-y-auto p-2">
            {groups.map((group) => (
              <div role="group" aria-label={group.name} key={group.name} className="not-last:mb-2">
                <div className="px-2 py-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{group.name}</div>
                {group.items.map(({ item, index }) => (
                  <button
                    id={`${listboxId}-${item.id}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    type="button"
                    key={item.id}
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm outline-none aria-selected:bg-accent aria-selected:text-accent-foreground hover:bg-accent hover:text-accent-foreground"
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => run(item)}
                  >
                    {item.icon && <span className="text-muted-foreground">{item.icon}</span>}
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            ))}
            {visibleItems.length === 0 && <div className="px-3 py-10 text-center text-sm text-muted-foreground" role="status">No matching commands</div>}
          </div>
          <div className="flex items-center gap-4 border-t bg-muted/40 px-4 py-2 text-[11px] text-muted-foreground"><span>↑↓ navigate</span><span>Enter run</span><span>Esc close</span></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
