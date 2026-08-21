import { createElement, type CSSProperties } from "react";
import { createAvatarRecipe, defineShatzAvatar } from "@oshtz/shatz-avatars";
import { resolveRunState } from "./runState";

defineShatzAvatar();

const palettes = [
  { color: "#ff6b6b", secondaryColor: "#28b8b4", background: "#ffe3bf" },
  { color: "#7c5cff", secondaryColor: "#e84a9b", background: "#e9ddff" },
  { color: "#198754", secondaryColor: "#e0a800", background: "#d9f4df" },
  { color: "#0f62fe", secondaryColor: "#33b1ff", background: "#d8e8ff" },
  { color: "#9f1853", secondaryColor: "#fa4d56", background: "#ffd6e8" },
  { color: "#007d79", secondaryColor: "#42be65", background: "#d1f5f2" },
] as const;

export function AgentAvatar({ id, label, status = "idle", className = "" }: { id: string; label: string; status?: string; className?: string }) {
  const recipe = createAvatarRecipe(id);
  const palette = palettes[Math.floor(recipe.shape[0] * palettes.length)];
  const state = resolveRunState(status);
  const cadence = 2.8 + recipe.shape[0] * .8;
  return (
    <span
      className={`wj-agent-avatar ${className}`.trim()}
      data-status={status}
      data-phase={state.phase}
      data-tone={state.tone}
      role="img"
      aria-label={`${label}, ${state.label}`}
      title={`${label} · ${state.label}`}
      style={{
        "--wj-agent-breathe-duration": `${cadence}s`,
        "--wj-agent-breathe-delay": `${-recipe.shape[0] * cadence}s`,
      } as CSSProperties}
    >
      {createElement("shatz-avatar", {
        "aria-hidden": "true",
        background: palette.background,
        color: palette.color,
        "secondary-color": palette.secondaryColor,
        seed: id,
        shape: "circle",
        title: "",
      })}
    </span>
  );
}
