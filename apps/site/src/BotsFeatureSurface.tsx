import type { CSSProperties, ReactNode } from "react";
import addIcon from "sargam-icons/Icons/Line/si_Add.svg";
import aiMonitorIcon from "sargam-icons/Icons/Line/si_AI_monitor.svg";
import "./BotsFeatureSurface.css";

function SargamIcon({ src }: { src: string }) {
  return <span className="sargam-icon" style={{ "--sargam-icon": `url("${src}")` } as CSSProperties} aria-hidden="true" />;
}

export default function BotsFeatureSurface({ releaseAvatar, researchAvatar }: { releaseAvatar: ReactNode; researchAvatar: ReactNode }) {
  return <>
    <span className="surface-bots-toolbar"><span><SargamIcon src={aiMonitorIcon} /><strong>Bots</strong><small>Reusable specialists</small></span><b><SargamIcon src={addIcon} />Create bot</b></span>
    <span className="surface-bot-suggestion"><small>Suggested to save</small><strong>Release verifier</strong><em>One-off specialist · Codex</em></span>
    <span className="surface-bot-list">
      <span className="surface-bot-card">{releaseAvatar}<span><strong>Release verifier</strong><small>Project · gpt-5.4-mini</small><em>Checks packages, signatures, and updater proof.</em></span><b>12 launches</b></span>
      <span className="surface-bot-card">{researchAvatar}<span><strong>Research scout</strong><small>Global · Claude Code</small><em>Finds evidence and proposes scoped tasks.</em></span><b>3 active</b></span>
    </span>
  </>;
}
