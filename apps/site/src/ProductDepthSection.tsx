import type { CSSProperties } from "react";
import checkIcon from "sargam-icons/Icons/Line/si_Check.svg";
import clockIcon from "sargam-icons/Icons/Line/si_Clock.svg";
import dashboardIcon from "sargam-icons/Icons/Line/si_Dashboard.svg";
import flowBranchIcon from "sargam-icons/Icons/Line/si_Flow_branch.svg";
import settingsIcon from "sargam-icons/Icons/Line/si_Settings.svg";
import "./ProductDepthSection.css";

const productDepth = [
  { icon: flowBranchIcon, eyebrow: "Controlled autonomy", title: "Agents coordinate inside your rules.", detail: "Allow, ask, or deny peer messages, bounded child agents, task handoffs, and review requests. Every decision lands in autonomy history." },
  { icon: dashboardIcon, eyebrow: "Floor · Board · Spec", title: "Plan at the right altitude.", detail: "Move from live execution to Kanban and project specs, bootstrap PRD/TDD documents, and decompose work with explicit dependencies." },
  { icon: clockIcon, eyebrow: "Recorded execution", title: "The run leaves a trail.", detail: "Trace work in Run Graph, reopen activity and session history, inspect transcripts, and keep provider API usage visible." },
  { icon: settingsIcon, eyebrow: "Durable local state", title: "Your workspace comes back.", detail: "Projects, named canvases, themes, sessions, and Plan state stay on-device with restart recovery and no hosted wheeljack account." },
  { icon: checkIcon, eyebrow: "Desktop updates", title: "Update with a recovery path.", detail: "Follow verified download progress, read release notes, restart into the update, and restore the previous app if health checks fail." },
] as const;

function SargamIcon({ src }: { src: string }) {
  return <span className="sargam-icon" style={{ "--sargam-icon": `url("${src}")` } as CSSProperties} aria-hidden="true" />;
}

export default function ProductDepthSection() {
  return <section className="product-depth section" aria-labelledby="product-depth-title">
    <div className="page-width">
      <div className="section-heading product-depth-heading">
        <p>More of the workspace</p>
        <h2 id="product-depth-title">The details stay visible.</h2>
        <div><p>The released desktop app keeps coordination, recovery, planning, and runtime evidence close without turning wheeljack into another hosted control plane.</p></div>
      </div>
      <div className="product-depth-grid">
        {productDepth.map((item) => <article className="product-depth-card" key={item.eyebrow}>
          <span className="product-depth-icon" aria-hidden="true"><SargamIcon src={item.icon} /></span>
          <p>{item.eyebrow}</p><h3>{item.title}</h3><span>{item.detail}</span>
        </article>)}
      </div>
    </div>
  </section>;
}
