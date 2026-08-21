import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist/wght.css";
import "@fontsource-variable/inter/wght.css";
import "@fontsource/geist-pixel";
import "@fontsource-variable/open-sans/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import { TooltipProvider } from "./components/ui/tooltip";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider delayDuration={300}>
      <App />
    </TooltipProvider>
  </StrictMode>,
);
