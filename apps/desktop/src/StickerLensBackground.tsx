import { useLayoutEffect, useRef } from "react";

const STICKER_SPECS = [
  ["wj-1", 1.63], ["wj-2", 1.325], ["wj-3", 1.908], ["wj-4", 0.857], ["wj-5", 3.98],
  ["wj-6", 1.056], ["wj-7", 1.13], ["wj-8", 1.504], ["wj-9", 0.822], ["wj-10", 2.647],
  ["wj-11", 1.232], ["wj-12", 2.538], ["wj-13", 0.806], ["wj-14", 3.366], ["wj-15", 1.086],
  ["wj-16", 0.468], ["wj-17", 4.623], ["wj-18", 2.481], ["wj-19", 0.794],
  ["wj-21", 0.957], ["wj-22", 1.075], ["wj-23", 1.001], ["wj-24", 0.822], ["wj-25", 1.623],
  ["wj-26", 1.169], ["wj-27", 1.755], ["wj-28", 1.135], ["wj-29", 1.429], ["wj-30", 0.615],
  ["wj-31", 1.739], ["wj-32", 1], ["wj-33", 1.039], ["wj-34", 1.35], ["wj-35", 5.825],
  ["wj-36", 1.368], ["wj-37", 3.251], ["wj-38", 2.858], ["wj-39", 6.269], ["wj-40", 0.988],
] as const;
const STICKER_SVGS = import.meta.glob("./assets/stickers/*.svg", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
const STICKERS = STICKER_SPECS.map(([id, aspect]) => ({
  id,
  aspect,
  svg: STICKER_SVGS[`./assets/stickers/${id}.svg`].replaceAll("#d94f2b", "currentColor"),
}));

const RADIUS = 240;
const LIFT = 0.62;
const SPREAD = 0.42;
const FALLOFF = 1.6;
const DIM = 0.55;
const SHADOW = 0.7;

interface StickerLayout {
  bx: number;
  by: number;
  width: number;
  height: number;
  rotation: number;
}

export interface StickerLensScene {
  seed: number;
}

export function createStickerLensScene(): StickerLensScene {
  return { seed: Math.floor(Math.random() * 0x100000000) };
}

function rng(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6D2B79F5) >>> 0;
    let result = Math.imul(value ^ (value >>> 15), 1 | value);
    result = (result + Math.imul(result ^ (result >>> 7), 61 | result)) ^ result;
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

export function layoutStickerLens(width: number, height: number, seed = 7): StickerLayout[] {
  if (width <= 0 || height <= 0) return [];
  const columns = Math.max(2, Math.round(Math.sqrt(STICKERS.length * width / height)));
  const rows = Math.ceil(STICKERS.length / columns);
  const cellWidth = width / columns;
  const cellHeight = height / rows;
  const random = rng(seed * 40503 + STICKERS.length);
  const slots = STICKERS.map((_, index) => index);
  for (let index = slots.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [slots[index], slots[other]] = [slots[other], slots[index]];
  }

  return STICKERS.map(({ aspect }, index) => {
    const column = slots[index] % columns;
    const row = Math.floor(slots[index] / columns);
    const area = cellWidth * cellHeight * 0.22 * (0.8 + random() * 0.42);
    let stickerWidth = Math.sqrt(area * aspect);
    let stickerHeight = Math.sqrt(area / aspect);
    if (stickerWidth > cellWidth * 1.35) {
      stickerWidth = cellWidth * 1.35;
      stickerHeight = stickerWidth / aspect;
    }
    if (stickerHeight > cellHeight * 1.15) {
      stickerHeight = cellHeight * 1.15;
      stickerWidth = stickerHeight * aspect;
    }
    const rotation = (random() - 0.5) * 16;
    const radians = Math.abs(rotation) * Math.PI / 180;
    const padX = (stickerWidth * Math.cos(radians) + stickerHeight * Math.sin(radians)) / 2 + 8;
    const padY = (stickerHeight * Math.cos(radians) + stickerWidth * Math.sin(radians)) / 2 + 8;
    const x = (column + 0.5) * cellWidth + (random() - 0.5) * cellWidth * 0.275 + (row % 2 ? cellWidth * 0.28 : 0);
    const y = (row + 0.5) * cellHeight + (random() - 0.5) * cellHeight * 0.275;
    return {
      bx: Math.min(width - padX, Math.max(padX, x)),
      by: Math.min(height - padY, Math.max(padY, y)),
      width: stickerWidth,
      height: stickerHeight,
      rotation,
    };
  });
}

export function stickerLensEntryPosition(sticker: StickerLayout, stageWidth: number, stageHeight: number, index: number) {
  const dx = sticker.bx - stageWidth / 2;
  const dy = sticker.by - stageHeight / 2;
  const distance = Math.hypot(dx, dy);
  const angle = index * 137.5 * Math.PI / 180;
  const unitX = distance > 1 ? dx / distance : Math.cos(angle);
  const unitY = distance > 1 ? dy / distance : Math.sin(angle);
  const travel = Math.max(stageWidth, stageHeight) * 0.55;
  return {
    x: sticker.bx - sticker.width / 2 + unitX * travel,
    y: sticker.by - sticker.height / 2 + unitY * travel,
  };
}

export function stickerLensInfluence(distance: number): number {
  let value = Math.max(0, 1 - distance / RADIUS);
  value = value * value * (3 - 2 * value);
  return Math.pow(value, FALLOFF);
}

export function StickerLensBackground({ host, scene }: { host: HTMLElement | null; scene: StickerLensScene }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const enteredSceneRef = useRef<StickerLensScene | undefined>(undefined);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const workspace = root?.parentElement;
    if (!root || !workspace || !host) {
      if (root) root.hidden = true;
      return;
    }
    root.hidden = false;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const elements = [...root.children] as HTMLElement[];
    const animateEntry = enteredSceneRef.current !== scene;
    enteredSceneRef.current = scene;
    let layout: StickerLayout[] = [];
    let lastX = -9999;
    let lastY = -9999;
    let velocityX = 0;
    let velocityY = 0;
    let entryStarted = false;
    let entered = false;
    let entryFrame = 0;
    let entryTimer = 0;

    const apply = (pointerX?: number, pointerY?: number) => {
      const active = pointerX !== undefined && pointerY !== undefined && !reducedMotion.matches;
      const speed = Math.min(1, Math.hypot(velocityX, velocityY) / 26);
      layout.forEach((sticker, index) => {
        const element = elements[index];
        const dx = active ? sticker.bx - pointerX : 0;
        const dy = active ? sticker.by - pointerY : 0;
        const distance = active ? Math.hypot(dx, dy) || 0.001 : Infinity;
        const influence = stickerLensInfluence(distance);
        const push = influence * RADIUS * SPREAD * 0.3;
        const x = Math.min(root.clientWidth - sticker.width * 0.72, Math.max(-sticker.width * 0.28, sticker.bx + dx / distance * push - sticker.width / 2));
        const y = Math.min(root.clientHeight - sticker.height * 0.72, Math.max(-sticker.height * 0.28, sticker.by + dy / distance * push - sticker.height / 2));
        const scale = 1 + influence * LIFT;
        const rotation = sticker.rotation * (1 - influence * 0.55) + influence * (Math.atan2(dy, dx) * 57.3 * 0.03 + velocityX * 0.12 * speed);
        const lift = scale - 1;
        element.style.transform = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0) rotate(${rotation.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
        element.style.opacity = (1 - DIM * 0.72 + DIM * 0.72 * Math.min(1, influence * 1.6)).toFixed(3);
        element.style.zIndex = String(100 + Math.round(influence * 120));
        element.style.filter = lift > 0.012
          ? `drop-shadow(0 ${(lift * 22).toFixed(1)}px ${(lift * 26 + 3).toFixed(1)}px rgba(22,21,15,${(Math.min(0.42, lift * 0.7) * SHADOW).toFixed(3)}))`
          : "";
      });
    };

    const reset = () => {
      lastX = -9999;
      lastY = -9999;
      velocityX = 0;
      velocityY = 0;
      if (entered) apply();
    };
    const move = (event: PointerEvent) => {
      if (!entered) return;
      const bounds = root.getBoundingClientRect();
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;
      if (x < 0 || x > bounds.width || y < 0 || y > bounds.height) return reset();
      const jumped = Math.abs(x - lastX) > 400 || Math.abs(y - lastY) > 400;
      velocityX = jumped ? 0 : Math.max(-32, Math.min(32, velocityX * 0.6 + (x - lastX) * 0.4));
      velocityY = jumped ? 0 : Math.max(-32, Math.min(32, velocityY * 0.6 + (y - lastY) * 0.4));
      lastX = x;
      lastY = y;
      apply(x, y);
    };
    const enter = () => {
      entryStarted = true;
      if (!animateEntry || reducedMotion.matches) {
        entered = true;
        apply();
        return;
      }
      layout.forEach((sticker, index) => {
        const element = elements[index];
        const start = stickerLensEntryPosition(sticker, root.clientWidth, root.clientHeight, index);
        element.style.transition = "none";
        element.style.transitionDelay = "";
        element.style.opacity = "0";
        element.style.transform = `translate3d(${start.x.toFixed(2)}px,${start.y.toFixed(2)}px,0) rotate(${sticker.rotation.toFixed(2)}deg) scale(.72)`;
      });
      void root.offsetWidth;
      entryFrame = requestAnimationFrame(() => {
        elements.forEach((element, index) => {
          element.style.transition = "";
          element.style.transitionDelay = `${(index * 17 % STICKERS.length) * 18}ms`;
        });
        apply();
        entryTimer = window.setTimeout(() => {
          elements.forEach((element) => { element.style.transitionDelay = ""; });
          entered = true;
          apply();
        }, (STICKERS.length - 1) * 18 + 520);
      });
    };
    const measure = () => {
      const bounds = host.getBoundingClientRect();
      const workspaceBounds = workspace.getBoundingClientRect();
      root.style.inset = "auto";
      root.style.left = `${bounds.left - workspaceBounds.left}px`;
      root.style.top = `${bounds.top - workspaceBounds.top}px`;
      root.style.width = `${bounds.width}px`;
      root.style.height = `${bounds.height}px`;
      layout = layoutStickerLens(bounds.width, bounds.height, scene.seed);
      layout.forEach((sticker, index) => {
        elements[index].style.width = `${sticker.width}px`;
        elements[index].style.height = `${sticker.height}px`;
      });
      if (!entryStarted) enter();
      else if (entered) apply();
    };
    const motionChange = () => {
      if (!reducedMotion.matches) return;
      cancelAnimationFrame(entryFrame);
      window.clearTimeout(entryTimer);
      elements.forEach((element) => {
        element.style.transition = "";
        element.style.transitionDelay = "";
      });
      entered = true;
      apply();
    };

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(host);
    resizeObserver.observe(workspace);
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerleave", reset);
    host.addEventListener("pointercancel", reset);
    reducedMotion.addEventListener("change", motionChange);
    measure();
    return () => {
      root.hidden = true;
      cancelAnimationFrame(entryFrame);
      window.clearTimeout(entryTimer);
      resizeObserver.disconnect();
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", reset);
      host.removeEventListener("pointercancel", reset);
      reducedMotion.removeEventListener("change", motionChange);
    };
  }, [host, scene]);

  return <div aria-hidden="true" className="wj-sticker-lens" hidden ref={rootRef}>
    {STICKERS.map((sticker) => <span dangerouslySetInnerHTML={{ __html: sticker.svg }} key={sticker.id} />)}
  </div>;
}
