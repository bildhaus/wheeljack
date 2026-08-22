import { Dithering, PaperTexture } from "@paper-design/shaders-react";
import type { ComponentProps } from "react";

export function DitherEffect(props: ComponentProps<typeof Dithering>) {
  return <Dithering {...props} />;
}

export function PaperTextureEffect(props: ComponentProps<typeof PaperTexture>) {
  return <PaperTexture {...props} />;
}
