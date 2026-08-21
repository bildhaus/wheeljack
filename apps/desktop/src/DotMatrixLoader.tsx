import type { CSSProperties } from "react";

export const dotMatrixLoaderAssets = {
  boot: "/dot-matrix/icon-53.svg",
  loading: "/dot-matrix/icon-07.svg",
  thinking: "/dot-matrix/icon-19.svg",
  compile: "/dot-matrix/icon-28.svg",
  verify: "/dot-matrix/icon-38.svg",
} as const;

export type DotMatrixLoaderVariant = keyof typeof dotMatrixLoaderAssets;

export function DotMatrixLoader({
  variant = "loading",
  size = 18,
  label,
  className,
}: {
  variant?: DotMatrixLoaderVariant;
  size?: number;
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={`wj-dot-matrix-loader${className ? ` ${className}` : ""}`}
      data-variant={variant}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{
        "--wj-dot-matrix-image": `url("${dotMatrixLoaderAssets[variant]}")`,
        "--wj-dot-matrix-size": `${size}px`,
      } as CSSProperties}
    >
      <span />
    </span>
  );
}
