import { useEffect, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover";
import { Slider } from "./components/ui/slider";
import { contrastRatio } from "./theme";
import { hexToHsv, hsvToHex, type HsvColor } from "./colorPicker";

interface Props {
  label: string;
  value: string;
  disabled?: boolean;
  contrastAgainst?: string;
  onChange: (value: string) => void;
  onReset?: () => void;
}

export function ColorPickerPopover({
  label,
  value,
  disabled = false,
  contrastAgainst,
  onChange,
  onReset,
}: Props) {
  const [draft, setDraft] = useState(value);
  const color = hexToHsv(value);
  useEffect(() => setDraft(value), [value]);

  const update = (next: HsvColor) => onChange(hsvToHex(next));
  const updateArea = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    update({
      ...color,
      s: Math.round(Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)) * 100),
      v: Math.round((1 - Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height))) * 100),
    });
  };
  const areaKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = event.shiftKey ? 10 : 1;
    const next = { ...color };
    if (event.key === "ArrowLeft") next.s -= delta;
    else if (event.key === "ArrowRight") next.s += delta;
    else if (event.key === "ArrowDown") next.v -= delta;
    else if (event.key === "ArrowUp") next.v += delta;
    else return;
    event.preventDefault();
    update(next);
  };
  const ratio = contrastAgainst ? contrastRatio(value, contrastAgainst) : undefined;
  const invalid = !/^#[0-9A-Fa-f]{6}$/.test(draft);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label className="capitalize">{label}</Label>
        {onReset && <Button variant="ghost" size="xs" onClick={onReset}>Reset</Button>}
      </div>
      <div className="wj-color-control">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="wj-color-swatch-button"
              disabled={disabled}
              aria-label={`Edit ${label} color`}
              title={`Edit ${label} color`}
            >
              <span className="h-3.5 w-7 rounded-[3px] border border-foreground/20" style={{ background: value }} />
            </Button>
          </PopoverTrigger>
          <PopoverContent aria-label={`${label} color editor`} className="w-[260px]">
            <div className="mb-3">
              <strong className="text-sm capitalize">{label}</strong>
              <p className="text-xs text-muted-foreground">Choose an opaque theme color.</p>
            </div>
            <div
              className="relative h-36 cursor-crosshair touch-none overflow-hidden rounded-md ring-1 ring-foreground/15"
              style={{
                background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${color.h} 100% 50%))`,
              }}
              role="slider"
              tabIndex={0}
              aria-label={`${label} saturation and brightness`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(color.v)}
              aria-valuetext={`${Math.round(color.s)}% saturation, ${Math.round(color.v)}% brightness`}
              onKeyDown={areaKey}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                updateArea(event);
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) updateArea(event);
              }}
              onPointerUp={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
              }}
            >
              <span
                className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.55)]"
                style={{ left: `${color.s}%`, top: `${100 - color.v}%` }}
              />
            </div>
            <div className="mt-3 space-y-2">
              <Label htmlFor={`hue-${label}`}>Hue</Label>
              <Slider
                id={`hue-${label}`}
                aria-label={`${label} hue`}
                className="wj-hue-slider"
                min={0}
                max={359}
                value={[color.h]}
                onValueChange={([h]) => update({ ...color, h })}
              />
            </div>
            <div className="mt-3">
              <Label htmlFor={`hex-${label}`}>Hex color</Label>
              <Input
                id={`hex-${label}`}
                aria-label={`${label} hex color`}
                aria-invalid={invalid}
                value={draft}
                onChange={(event) => {
                  const next = event.target.value.toUpperCase();
                  setDraft(next);
                  if (/^#[0-9A-F]{6}$/.test(next)) onChange(next);
                }}
              />
              {invalid && <p className="mt-1 text-xs text-destructive" role="alert">Enter an opaque color as #RRGGBB.</p>}
              {ratio !== undefined && (
                <p className={`mt-1 text-xs ${ratio < 4.5 ? "text-destructive" : "text-muted-foreground"}`} role="status">
                  Contrast {ratio.toFixed(2)}:1 · {ratio < 4.5 ? "below 4.5:1" : "passes AA"}
                </p>
              )}
            </div>
          </PopoverContent>
        </Popover>
        <Input
          className="wj-color-hex-input font-mono tabular-nums uppercase"
          aria-label={`${label} hex`}
          disabled={disabled}
          value={draft}
          aria-invalid={invalid}
          onChange={(event) => {
            const next = event.target.value.toUpperCase();
            setDraft(next);
            if (/^#[0-9A-F]{6}$/.test(next)) onChange(next);
          }}
        />
      </div>
    </div>
  );
}
