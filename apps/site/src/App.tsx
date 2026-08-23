import { useGSAP } from "@gsap/react";
import { createAvatarRecipe, defineShatzAvatar } from "@oshtz/shatz-avatars";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ReactLenis, type LenisRef } from "lenis/react";
import { createElement, lazy, Suspense, useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import addIcon from "sargam-icons/Icons/Line/si_Add.svg";
import aiMonitorIcon from "sargam-icons/Icons/Line/si_AI_monitor.svg";
import arrowRightSquareIcon from "sargam-icons/Icons/Line/si_Arrow_right_square.svg";
import checkIcon from "sargam-icons/Icons/Line/si_Check.svg";
import clockIcon from "sargam-icons/Icons/Line/si_Clock.svg";
import closeIcon from "sargam-icons/Icons/Line/si_Close.svg";
import codeIcon from "sargam-icons/Icons/Line/si_Code.svg";
import dashboardIcon from "sargam-icons/Icons/Line/si_Dashboard.svg";
import flowBranchIcon from "sargam-icons/Icons/Line/si_Flow_branch.svg";
import projectIcon from "sargam-icons/Icons/Line/si_Projects.svg";
import homeIcon from "sargam-icons/Icons/Line/si_Home.svg";
import moreIcon from "sargam-icons/Icons/Line/si_More_horiz.svg";
import notificationsIcon from "sargam-icons/Icons/Line/si_Notifications.svg";
import panelLeftIcon from "sargam-icons/Icons/Line/si_Chevron_left_alt.svg";
import playIcon from "sargam-icons/Icons/Line/si_Play.svg";
import removeIcon from "sargam-icons/Icons/Line/si_Remove.svg";
import settingsIcon from "sargam-icons/Icons/Line/si_Settings.svg";
import terminalIcon from "sargam-icons/Icons/Line/si_Terminal.svg";
import windowIcon from "sargam-icons/Icons/Line/si_Window.svg";

gsap.registerPlugin(useGSAP, ScrollTrigger);
defineShatzAvatar();

const downloadsLive = true;
const paperField = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E%3Cpath fill='%23f3f2ee' d='M0 0h8v8H0z'/%3E%3C/svg%3E";
const WjHeroModel = lazy(() => import("./WjHeroModel"));
const DitherEffect = lazy(async () => ({ default: (await import("./PaperEffects")).DitherEffect }));
const PaperTextureEffect = lazy(async () => ({ default: (await import("./PaperEffects")).PaperTextureEffect }));
const BotsFeatureSurface = lazy(() => import("./BotsFeatureSurface"));
const ProductDepthSection = lazy(() => import("./ProductDepthSection"));

const downloads = {
  windows: "https://github.com/bildhaus/wheeljack/releases/latest/download/wheeljack-windows-x64-portable.exe",
  macos: "https://github.com/bildhaus/wheeljack/releases/latest/download/wheeljack-macos-universal.dmg",
  release: "https://github.com/bildhaus/wheeljack/releases/latest",
  checksums: "https://github.com/bildhaus/wheeljack/releases/latest/download/SHA256SUMS.txt",
};

const integrations = [
  { id: "claude-code", name: "Claude Code" },
  { id: "codex-cli", name: "Codex CLI" },
  { id: "opencode", name: "OpenCode" },
  { id: "pi-coding-agent", name: "Pi Coding Agent" },
] as const;

type ProviderId = typeof integrations[number]["id"];

const avatarPalettes = [
  { color: "#ff6b6b", secondaryColor: "#28b8b4", background: "#ffe3bf" },
  { color: "#7c5cff", secondaryColor: "#e84a9b", background: "#e9ddff" },
  { color: "#198754", secondaryColor: "#e0a800", background: "#d9f4df" },
  { color: "#0f62fe", secondaryColor: "#33b1ff", background: "#d8e8ff" },
  { color: "#9f1853", secondaryColor: "#fa4d56", background: "#ffd6e8" },
  { color: "#007d79", secondaryColor: "#42be65", background: "#d1f5f2" },
] as const;

const features = [
  {
    id: "terminal",
    title: "Work",
    lead: "A real workspace, not a tab pile.",
    detail: "Split panes recursively, keep named canvases, and move from shell to structured agent chat without leaving the project.",
  },
  {
    id: "agents",
    title: "Agents",
    lead: "Bring the CLIs you already trust.",
    detail: "Run Claude Code, Codex CLI, OpenCode, Pi, or a plain shell side by side while wheeljack keeps their sessions legible.",
  },
  {
    id: "ops",
    title: "Plan",
    lead: "Plans stay attached to execution.",
    detail: "Turn scoped tasks into isolated Git worktree lanes with dependencies, constraints, and verification commands close at hand.",
  },
  {
    id: "review",
    title: "Review",
    lead: "Evidence before delivery.",
    detail: "See changed files, handoff notes, acceptance criteria, and checks before work is marked complete.",
  },
  {
    id: "bots",
    title: "Bots",
    lead: "Save the specialists worth keeping.",
    detail: "Create reusable project or global profiles with a standing role, agent, model, effort, and an immutable launch snapshot.",
  },
] as const;


const workflowCards = [
  {
    phase: "Plan",
    title: "Give the work a contract.",
    copy: "Define the outcome, constraints, dependencies, expected files, and the proof that will count as done.",
    body: <PlanCard />,
  },
  {
    phase: "Run",
    title: "Let agents work in clear lanes.",
    copy: "Assign a task to a structured session in the shared checkout or an isolated Git worktree.",
    body: <RunCard />,
  },
  {
    phase: "Review",
    title: "Only decisions come back to you.",
    copy: "Questions, permission requests, overlaps, failures, and review evidence surface when your judgment is needed.",
    body: <ReviewCard />,
  },
];

export function App() {
  const pageRef = useRef<HTMLDivElement>(null);
  const [activeFeature, setActiveFeature] = useState<number | null>(null);
  const [smoothScroll, setSmoothScroll] = useState(() => !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [showHeroModel, setShowHeroModel] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => setSmoothScroll(!media.matches);
    media.addEventListener("change", syncPreference);
    return () => media.removeEventListener("change", syncPreference);
  }, []);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 581px)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string; addEventListener?: (type: string, listener: () => void) => void; removeEventListener?: (type: string, listener: () => void) => void } }).connection;
    let idleHandle: number | undefined;
    let timeoutHandle: number | undefined;

    const cancelPending = () => {
      if (idleHandle !== undefined && "cancelIdleCallback" in window) window.cancelIdleCallback(idleHandle);
      if (timeoutHandle !== undefined) window.clearTimeout(timeoutHandle);
      idleHandle = undefined;
      timeoutHandle = undefined;
    };
    const syncPreference = () => {
      cancelPending();
      const slowConnection = connection?.effectiveType === "slow-2g" || connection?.effectiveType === "2g";
      if (!desktop.matches || reducedMotion.matches || connection?.saveData || slowConnection) {
        setShowHeroModel(false);
        return;
      }
      const reveal = () => setShowHeroModel(true);
      if ("requestIdleCallback" in window) idleHandle = window.requestIdleCallback(reveal, { timeout: 1_500 });
      else timeoutHandle = setTimeout(reveal, 900);
    };

    syncPreference();
    desktop.addEventListener("change", syncPreference);
    reducedMotion.addEventListener("change", syncPreference);
    connection?.addEventListener?.("change", syncPreference);
    return () => {
      cancelPending();
      desktop.removeEventListener("change", syncPreference);
      reducedMotion.removeEventListener("change", syncPreference);
      connection?.removeEventListener?.("change", syncPreference);
    };
  }, []);

  useGSAP(() => {
    const media = gsap.matchMedia();

    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.from(".hero-copy > *", {
        y: 30,
        opacity: 0,
        duration: 1.05,
        stagger: 0.08,
        ease: "power4.out",
      });

      gsap.from(".hero-product", {
        yPercent: 8,
        scale: 0.92,
        opacity: 0,
        duration: 1.3,
        delay: 0.12,
        ease: "power4.out",
      });

      gsap.utils.toArray<HTMLElement>(".section-heading, .sticker-pasteup, .download-copy, .download-options").forEach((element) => {
        gsap.from(element, {
          y: 46,
          opacity: 0,
          duration: 1,
          ease: "power3.out",
          scrollTrigger: {
            trigger: element,
            start: "top 84%",
            once: true,
          },
        });
      });
    });

    media.add("(min-width: 581px) and (prefers-reduced-motion: no-preference)", () => {
      const terminalLines = gsap.utils.toArray<HTMLElement>(".product-terminal-line");
      const agentSteps = gsap.utils.toArray<HTMLElement>(".product-agent-step");
      const workSteps = agentSteps.slice(0, -1);
      const evidenceStep = agentSteps.at(-1);
      const focusRings = gsap.utils.toArray<HTMLElement>(".pane-focus");
      const teamRows = gsap.utils.toArray<HTMLElement>(".product-agent-row");
      const opsCards = gsap.utils.toArray<HTMLElement>(".product-ops-card");
      const opsProgress = gsap.utils.toArray<HTMLElement>(".product-ops-progress i");
      const reviewSections = gsap.utils.toArray<HTMLElement>(".product-review-section");
      const reviewChecks = gsap.utils.toArray<HTMLElement>(".product-review-checks span");

      gsap.set([...terminalLines, ...agentSteps, ...opsCards, ...opsProgress, ...reviewSections, ...reviewChecks], { y: 4, opacity: 0 });
      gsap.set(focusRings, { opacity: 0 });
      gsap.set(teamRows, { opacity: 0.72 });
      gsap.set(".product-ops-scene", { y: 12, opacity: 0 });
      gsap.set(".product-review-inspector", { xPercent: 105, opacity: 0 });
      gsap.set(".product-ops-task-review", { x: -18 });
      gsap.set(".product-agent-status-ready", { y: 4, opacity: 0 });
      gsap.set(".product-plan-toolbar, .product-plan-tabs", { y: 4, opacity: 0 });

      gsap.timeline({ repeat: -1, repeatDelay: 1, defaults: { ease: "power2.out" } })
        .to(".agent-pane .pane-focus", { opacity: 1, duration: 0.18 })
        .to(workSteps, { y: 0, opacity: 1, duration: 0.36, stagger: 0.58 }, "<+0.08")
        .to(".agent-pane .pane-focus", { opacity: 0, duration: 0.2 }, "+=0.8")
        .to(".terminal-pane .pane-focus", { opacity: 1, duration: 0.18 }, "<")
        .to(terminalLines, { y: 0, opacity: 1, duration: 0.28, stagger: 0.38 }, "<+0.06")
        .to(".terminal-pane .pane-focus", { opacity: 0, duration: 0.2 }, "+=0.7")
        .to(evidenceStep ?? [], { y: 0, opacity: 1, duration: 0.34 }, "<")
        .to(teamRows[0], { opacity: 1, duration: 0.24 }, "<")
        .to(".product-agent-status-running", { y: -4, opacity: 0, duration: 0.2 }, "<")
        .to(".product-agent-status-ready", { y: 0, opacity: 1, duration: 0.24 }, "<+0.06")
        .to(".product-agent-row:first-of-type .product-agent-avatar", { scale: 1.07, duration: 0.18, repeat: 1, yoyo: true }, "<")
        .to(".product-terminal-scene", { y: -8, opacity: 0.08, duration: 0.48 }, "+=1.6")
        .to(".product-ops-scene", { y: 0, opacity: 1, duration: 0.52 }, "<+0.1")
        .to(".product-nav-terminal", { color: "#7f7f7f", backgroundColor: "transparent", duration: 0.22 }, "<")
        .to(".product-plan-slot", { width: 112, duration: 0.28 }, "<")
        .to(".product-nav-ops", { y: -4, opacity: 0, duration: 0.18 }, "<")
        .to(".product-plan-tabs", { y: 0, opacity: 1, duration: 0.24 }, "<+0.06")
        .to(".product-work-toolbar", { y: -4, opacity: 0, duration: 0.2 }, "<")
        .to(".product-plan-toolbar", { y: 0, opacity: 1, duration: 0.24 }, "<+0.05")
        .to(opsCards.slice(0, -1), { y: 0, opacity: 1, duration: 0.3, stagger: 0.14 }, "<+0.16")
        .to(opsProgress, { y: 0, opacity: 1, duration: 0.2, stagger: 0.28 }, "+=0.45")
        .to(".product-ops-task-live", { scale: 1.025, duration: 0.18, repeat: 1, yoyo: true }, "<")
        .to(".product-ops-task-live", { x: 112, opacity: 0, duration: 0.62 }, "+=1.1")
        .to(".product-ops-task-review", { x: 0, y: 0, opacity: 1, duration: 0.5 }, "<+0.14")
        .to(".product-review-inspector", { xPercent: 0, opacity: 1, duration: 0.62 }, "+=1.2")
        .to(".product-ops-scene", { opacity: 0.34, duration: 0.35 }, "<")
        .to(reviewSections, { y: 0, opacity: 1, duration: 0.3, stagger: 0.22 }, "<+0.2")
        .to(reviewChecks, { y: 0, opacity: 1, duration: 0.24, stagger: 0.18 }, "<+0.36")
        .to(".product-review-inspector", { xPercent: 105, opacity: 0, duration: 0.48 }, "+=3.6")
        .to(".product-ops-scene", { y: -8, opacity: 0, duration: 0.4 }, "<+0.06")
        .to(".product-plan-tabs, .product-plan-toolbar", { y: 4, opacity: 0, duration: 0.18 }, "<")
        .to(".product-plan-slot", { width: 52, duration: 0.24 }, "<")
        .to(".product-nav-ops", { y: 0, opacity: 1, duration: 0.18 }, "<+0.05")
        .to(".product-work-toolbar", { y: 0, opacity: 1, duration: 0.2 }, "<")
        .set([...terminalLines, ...agentSteps, ...opsCards, ...opsProgress, ...reviewSections, ...reviewChecks], { y: 4, opacity: 0 })
        .set(".product-ops-task-live", { x: 0, scale: 1 })
        .set(".product-ops-task-review", { x: -18 })
        .set(".product-ops-scene", { y: 12 })
        .set(".product-terminal-scene", { y: 0, opacity: 1 })
        .set(".product-agent-status-running", { y: 0, opacity: 1 })
        .set(".product-agent-status-ready", { y: 4, opacity: 0 })
        .set(".product-nav-terminal", { color: "#f4f4f4", backgroundColor: "#252525" })
        .set(teamRows, { opacity: 0.72 });
    });

    media.add("(min-width: 960px) and (prefers-reduced-motion: no-preference)", () => {
      const cards = gsap.utils.toArray<HTMLElement>(".workflow-card");
      gsap.set(cards.slice(1), { yPercent: 108 });

      gsap.to(".product-bezel", {
        yPercent: 14,
        scale: 0.9,
        opacity: 0.24,
        ease: "none",
        scrollTrigger: {
          trigger: ".hero",
          start: "55% center",
          end: "bottom top",
          scrub: 0.8,
        },
      });

      const timeline = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: {
          trigger: ".workflow-scroll",
          start: "top top",
          end: "+=220%",
          pin: ".workflow-pin",
          pinSpacing: true,
          scrub: 0.85,
          anticipatePin: 1,
          invalidateOnRefresh: true,
        },
      });

      cards.slice(1).forEach((card, index) => {
        timeline
          .to(cards[index], { scale: 0.955, opacity: 0.42, duration: 1 }, index)
          .to(card, { yPercent: 0, duration: 1 }, index);
      });
    });

    return () => media.revert();
  }, { scope: pageRef });

  const accordionColumns = activeFeature === null
    ? features.map(() => "minmax(0, 3fr)").join(" ")
    : features.map((_, index) => `minmax(0, ${index === activeFeature ? 6 : 2}fr)`).join(" ");

  const page = (
    <div className="site" ref={pageRef}>
      <a className="skip-link" href="#top">Skip to content</a>
      <SiteNav />
      <main id="top">
        <div className="hero-sequence">
        <section className="hero" aria-labelledby="hero-title">
          {showHeroModel && (
            <Suspense fallback={null}>
              <WjHeroModel animated={smoothScroll} />
            </Suspense>
          )}
          <div className="hero-grid page-width">
            <div className="hero-copy">
              <p className="hero-kicker">local-first agent workspace</p>
              <h1 id="hero-title">Your terminal. Your agents. One workspace.</h1>
              <p className="hero-deck">
                wheeljack brings split terminals, structured agent sessions, isolated task lanes,
                and review evidence together on your machine.
              </p>
              <div className="hero-actions">
                <ActionLink href="#workflow" label="See how it works" icon={flowBranchIcon} hoverIcon={playIcon} motion="workflow" />
                <ActionLink href="#features" label="Explore features" icon={codeIcon} hoverIcon={arrowRightSquareIcon} motion="source" secondary />
              </div>
            </div>

            <div className="hero-product" role="img" aria-label="Animated wheeljack workspace showing an agent task moving from Work execution to Plan and review evidence">
              <ProductWindow />
            </div>
          </div>
        </section>

        <div className="hero-paper-transition" aria-hidden="true">
          <PaperDither animated={smoothScroll} colorBack="#0c0c0c" />
        </div>

        <div className="feature-paper-chapter">
          <DeferredPaperTexture
            className="feature-paper-texture"
            image={paperField}
          />
          <IntegrationStrip />

          <section className="features section" id="features" aria-labelledby="features-title">
            <div className="page-width">
              <div className="section-heading features-heading">
                <p>Everything stays connected</p>
                <h2 id="features-title">Built for the whole loop.</h2>
                <div>
                  <p>
                    Terminals, agent sessions, task contracts, and review evidence share one durable
                    project context instead of scattering across windows.
                  </p>
                </div>
              </div>

              <div
                className={`feature-accordion${activeFeature === null ? " idle" : ""}`}
                style={{ gridTemplateColumns: accordionColumns } as CSSProperties}
                aria-label="wheeljack capabilities"
              >
                {features.map((feature, index) => {
                  const active = activeFeature === index;
                  return (
                    <button
                      className={`feature-panel${active ? " active" : ""}`}
                      type="button"
                      key={feature.id}
                      aria-expanded={active}
                      aria-controls={`feature-${feature.id}-detail`}
                      onClick={() => setActiveFeature((current) => current === index ? null : index)}
                    >
                      <span className="feature-panel-top">
                        <span className="feature-indicator" />
                        <span>{feature.title}</span>
                      </span>
                      <span className="feature-detail" id={`feature-${feature.id}-detail`} aria-hidden={!active}>
                        <strong>{feature.lead}</strong>
                        <span>{feature.detail}</span>
                      </span>
                      <FeatureSurface kind={feature.id} active={active} />
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        </div>
        </div>

        <section className="workflow-scroll" id="workflow" aria-labelledby="workflow-title">
          <div className="workflow-pin page-width">
            <div className="workflow-copy">
              <p>From prompt to proof.</p>
              <h2 id="workflow-title">Work moves. You keep the final say.</h2>
              <p className="workflow-deck">
                wheeljack gives every task a visible route from intent, through execution, to the
                evidence you need to approve it.
              </p>
              <ol className="workflow-steps">
                {workflowCards.map((card) => <li key={card.phase}>{card.phase}</li>)}
              </ol>
            </div>

            <div className="workflow-stack">
              {workflowCards.map((card, index) => (
                <article className="workflow-card" key={card.phase} style={{ zIndex: index + 1 }}>
                  <div className="workflow-card-copy">
                    <span>{card.phase}</span>
                    <h3>{card.title}</h3>
                    <p>{card.copy}</p>
                  </div>
                  {card.body}
                </article>
              ))}
            </div>
          </div>
        </section>

        <DeferredProductDepthSection />
        <DitherTransition animated={smoothScroll} />
        <DownloadSection />
      </main>
      <SiteFooter />
    </div>
  );

  return smoothScroll ? <SmoothScroll>{page}</SmoothScroll> : page;
}

function DitherTransition({ animated }: { animated: boolean }) {
  return (
    <div className="dither-transition" aria-hidden="true">
      <PaperDither animated={animated} />
      <div className="sticker-pasteup">
        <div className="sticker-pasteup-inner page-width">
          <img className="pasteup-sticker sticker-flow" src="/stickers/wj-17.svg" alt="" draggable={false} />
          <img className="pasteup-sticker sticker-poster" src="/stickers/wj-29.svg" alt="" draggable={false} />
          <img className="pasteup-sticker sticker-review" src="/stickers/wj-31.svg" alt="" draggable={false} />
        </div>
      </div>
    </div>
  );
}

function PaperDither({ animated, colorBack = "#101010" }: { animated: boolean; colorBack?: string }) {
  const [hostRef, visible] = useNearViewport();
  return (
    <div className="paper-effect-host" ref={hostRef}>
      {visible && <Suspense fallback={null}><DitherEffect colorBack={colorBack} colorFront="#f3f2ee" shape="wave" type="random" size={2.5} speed={animated ? 0.08 : 0} scale={1.34} /></Suspense>}
    </div>
  );
}

function DeferredPaperTexture({ className, image }: { className: string; image: string }) {
  const [hostRef, visible] = useNearViewport("600px");
  return (
    <div className={className} ref={hostRef} aria-hidden="true">
      {visible && <Suspense fallback={null}><PaperTextureEffect image={image} colorFront="#e2e1dc" colorBack="#f3f2ee" contrast={0.16} roughness={0.28} fiber={0.2} fiberSize={0.16} crumples={0.1} crumpleSize={0.28} folds={0} drops={0} scale={1} maxPixelCount={1_500_000} /></Suspense>}
    </div>
  );
}

function useNearViewport(rootMargin = "400px"): [RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const target = ref.current;
    if (!target || !("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setVisible(true);
      observer.disconnect();
    }, { rootMargin });
    observer.observe(target);
    return () => observer.disconnect();
  }, [rootMargin]);
  return [ref, visible];
}

function SmoothScroll({ children }: { children: ReactNode }) {
  const lenisRef = useRef<LenisRef>(null);

  useEffect(() => {
    const update = (time: number) => lenisRef.current?.lenis?.raf(time * 1000);
    const lenis = lenisRef.current?.lenis;
    lenis?.on("scroll", ScrollTrigger.update);
    gsap.ticker.add(update);
    gsap.ticker.lagSmoothing(0);
    ScrollTrigger.refresh();

    return () => {
      lenis?.off("scroll", ScrollTrigger.update);
      gsap.ticker.remove(update);
    };
  }, []);

  return (
    <ReactLenis root ref={lenisRef} options={{ autoRaf: false, anchors: true, lerp: 0.085, smoothWheel: true }}>
      {children}
    </ReactLenis>
  );
}

function SiteNav() {
  return (
    <header className="nav-wrap">
      <nav className="site-nav" aria-label="Primary navigation">
        <a className="nav-brand" href="#top" aria-label="wheeljack home">
          <img className="nav-wordmark" src="/wheeljack-lockup.svg" alt="" />
          <img className="nav-mark" src="/favicon.svg" alt="" />
        </a>
        <div className="nav-links">
          <a href="#features">Features</a>
          <a href="#workflow">Workflow</a>
          <a href="#download">Downloads</a>
          <a href="https://docs.wheeljack.dev">Docs</a>
        </div>
        <a className="nav-cta" href="#download">
          <span>Get wheeljack</span>
          <Arrow />
        </a>
      </nav>
    </header>
  );
}

function ActionLink({ href, label, icon, hoverIcon, motion, secondary = false, external = false }: { href: string; label: string; icon: string; hoverIcon: string; motion: "workflow" | "source"; secondary?: boolean; external?: boolean }) {
  return (
    <a className={`action-link action-link-${motion}${secondary ? " secondary" : ""}`} href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>
      <span>{label}</span>
      <span className="action-icon" aria-hidden="true"><SargamIcon src={icon} /><SargamIcon src={hoverIcon} /></span>
    </a>
  );
}

function Arrow() {
  return (
    <svg className="arrow-glyph" viewBox="0 0 16 16" aria-hidden="true">
      <g className="arrow-primary"><path d="M3 8h9" /><path d="m8.5 4.5 3.5 3.5-3.5 3.5" /></g>
      <g className="arrow-secondary"><path d="M3 8h9" /><path d="m8.5 4.5 3.5 3.5-3.5 3.5" /></g>
    </svg>
  );
}

function ProviderMark({ id }: { id: ProviderId }) {
  return (
    <span
      className="provider-mark"
      style={{ "--provider-logo": `url(/providers/${id === "claude-code" ? "claude" : id === "codex-cli" ? "codex" : id}.svg)` } as CSSProperties}
      aria-hidden="true"
    />
  );
}

function SargamIcon({ src }: { src: string }) {
  return <span className="sargam-icon" style={{ "--sargam-icon": `url("${src}")` } as CSSProperties} aria-hidden="true" />;
}

function ProductAgentAvatar({ id, label, status }: { id: string; label: string; status: "running" | "needs_input" | "completed" }) {
  const recipe = createAvatarRecipe(id);
  const palette = avatarPalettes[Math.floor(recipe.shape[0] * avatarPalettes.length)];
  return (
    <span className="product-agent-avatar" data-status={status} role="img" aria-label={`${label}, ${status.replaceAll("_", " ")}`}>
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

function ProductWindow() {
  return (
    <div className="product-bezel" aria-hidden="true">
      <div className="product-window">
        <header className="product-titlebar">
          <div className="product-brand"><img className="product-lockup" src="/wheeljack-lockup.svg" alt="" /></div>
          <div className="product-title-workspace">
            <span className="product-context"><SargamIcon src={projectIcon} /><b>wheeljack</b><small><SargamIcon src={flowBranchIcon} />main</small></span>
            <div className="product-mode-switch product-title-mode">
              <span className="product-nav-terminal"><SargamIcon src={terminalIcon} />Work</span>
              <span className="product-plan-slot">
                <span className="product-nav-ops"><SargamIcon src={dashboardIcon} />Plan</span>
                <span className="product-plan-tabs"><b>Board</b><i>PRD</i><i>TDD</i></span>
              </span>
            </div>
          </div>
          <div className="product-title-actions" aria-hidden="true"><div className="product-utilities"><SargamIcon src={notificationsIcon} /><SargamIcon src={flowBranchIcon} /><SargamIcon src={clockIcon} /></div><div className="window-controls"><SargamIcon src={removeIcon} /><SargamIcon src={windowIcon} /><SargamIcon src={closeIcon} /></div></div>
        </header>
        <div className="product-body">
          <aside className="product-sidebar">
            <span className="sidebar-home"><SargamIcon src={homeIcon} />Home</span>
            <div className="sidebar-label"><strong>Projects</strong><SargamIcon src={addIcon} /></div>
            <div className="sidebar-project">
              <span className="project-row"><SargamIcon src={projectIcon} />wheeljack</span>
            </div>
            <footer><span><SargamIcon src={settingsIcon} />Settings</span><span><SargamIcon src={panelLeftIcon} />Collapse</span></footer>
          </aside>
          <div className="product-main">
            <div className="product-toolbar-shell">
              <div className="product-toolbar product-work-toolbar">
                <div className="product-canvas-bar"><span className="product-canvas-tab"><b>Main canvas</b><SargamIcon src={moreIcon} /></span><SargamIcon src={addIcon} /></div>
                <div className="product-toolbar-actions"><strong><SargamIcon src={addIcon} />New pane</strong><span><SargamIcon src={aiMonitorIcon} />Agent</span></div>
              </div>
              <div className="product-toolbar product-plan-toolbar">
                <div className="product-plan-breadcrumb"><SargamIcon src={dashboardIcon} /><strong>Plan</strong><small>3 tasks</small></div>
                <div className="product-plan-actions"><span className="product-view-control"><small>View</small><b>Columns</b><i>List</i></span><span className="product-agent-control"><ProductAgentAvatar id="hero-toolbar-codex" label="Codex" status="running" />1 active</span><strong><SargamIcon src={addIcon} />New task</strong></div>
              </div>
            </div>
            <div className="product-stage">
              <div className="product-scene product-terminal-scene product-panes">
                <div className="terminal-pane">
                  <span className="pane-focus" aria-hidden="true" />
                  <header><span><i />powershell <small>running</small></span><SargamIcon src={moreIcon} /></header>
                  <pre>
                    <span className="product-terminal-line"><b>PS</b> bun run test</span>
                    <span className="product-terminal-line terminal-result">✓ 47 tests passed</span>
                    <span className="product-terminal-line"><b>PS</b> git status --short</span>
                    <span className="product-terminal-line terminal-change"> M apps/desktop/src/App.tsx</span>
                    <span className="product-terminal-line"><b>PS</b> <i className="terminal-cursor" /></span>
                  </pre>
                </div>
                <div className="agent-pane">
                  <span className="pane-focus" aria-hidden="true" />
                  <header><span><ProviderMark id="codex-cli" /><strong>Codex</strong><small>running · Review route</small></span><SargamIcon src={moreIcon} /></header>
                  <div className="agent-message product-agent-step">Implement the review route and verify the acceptance checks.</div>
                  <div className="agent-response product-agent-step"><strong>Working</strong><span>Tracing the existing routing flow before editing.</span></div>
                  <div className="agent-tool product-agent-step"><i />Reading ParitySurfaces.tsx</div>
                  <div className="agent-evidence product-agent-step"><SargamIcon src={checkIcon} />Evidence attached · ready for review</div>
                </div>
              </div>

              <div className="product-scene product-ops-scene">
                <div className="product-ops-board">
                  <section className="product-ops-column">
                    <header><strong>Ready</strong><small>1</small></header>
                    <article className="product-ops-card"><strong>Polish task capture</strong><p>Keep the task contract close to execution.</p><small>normal priority</small></article>
                  </section>
                  <section className="product-ops-column">
                    <header><strong>Running</strong><small>1</small></header>
                    <article className="product-ops-card product-ops-task-live"><strong>Review routing</strong><p>Codex · isolated worktree</p><div className="product-ops-progress"><i /><i /><i /></div><small>feature/review-route</small></article>
                  </section>
                  <section className="product-ops-column">
                    <header><strong>Review</strong><small>1</small></header>
                    <article className="product-ops-card product-ops-task-review"><strong>Review routing</strong><p>Evidence ready</p><small>3/3 checks passed</small></article>
                  </section>
                </div>
              </div>

              <aside className="product-review-inspector">
                <header className="product-review-head"><span><strong>Review</strong><small>normal priority</small></span><b>Review routing</b><p>Open the exact task context before delivery.</p></header>
                <div className="product-review-body">
                  <section className="product-review-section"><header><strong>Execution</strong><small>02:14</small></header><div className="product-review-pair"><span>Owner<b>Codex</b></span><span>Reviewer<b>Human approval</b></span></div><div className="product-review-workspace"><span>Workspace</span><code>worktree/feature-review-route</code></div></section>
                  <section className="product-review-section"><header><strong>Delegation contract</strong></header><div className="product-review-contract"><span>Definition of done<b>Review route opens the exact task context</b></span><span>Verification<code>bun run test</code></span></div></section>
                  <section className="product-review-section"><header><strong>Verification evidence</strong><small>3/3</small></header><div className="product-review-checks"><span><SargamIcon src={checkIcon} />Acceptance criteria</span><span><SargamIcon src={checkIcon} />47 tests passed</span><span><SargamIcon src={checkIcon} />Changed files reviewed</span></div></section>
                </div>
              </aside>
            </div>
          </div>
          <aside className="product-rail">
            <header><strong>Team</strong><small>3 sessions</small></header>
            <span className="product-agent-row"><ProductAgentAvatar id="codex-review" label="Codex" status="running" /><b>Codex</b><em className="product-agent-status"><span className="product-agent-status-running">running</span><span className="product-agent-status-ready">review ready</span></em><small>Review routing</small></span>
            <span className="product-agent-row"><ProductAgentAvatar id="claude-acceptance" label="Claude Code" status="needs_input" /><b>Claude Code</b><em>needs input</em><small>Acceptance paths</small></span>
            <span className="product-agent-row"><ProductAgentAvatar id="opencode-ready" label="OpenCode" status="completed" /><b>OpenCode</b><em>completed</em><small>Available</small></span>
          </aside>
        </div>
      </div>
    </div>
  );
}

function IntegrationStrip() {
  return (
    <section className="integrations" aria-label={`Works with ${integrations.map(({ name }) => name).join(", ")}`}>
      <div className="integrations-inner page-width">
        <span className="integrations-label">works with</span>
        <div className="integration-list">
          {integrations.map(({ id, name }) => <span key={id}><ProviderMark id={id} />{name}</span>)}
        </div>
      </div>
    </section>
  );
}

function DeferredProductDepthSection() {
  const [hostRef, visible] = useNearViewport("800px");
  return <div className={`product-depth-placeholder${visible ? " loaded" : ""}`} ref={hostRef}>{visible && <Suspense fallback={null}><ProductDepthSection /></Suspense>}</div>;
}

function FeatureSurface({ kind, active }: { kind: typeof features[number]["id"]; active: boolean }) {
  return (
    <span className={`feature-surface surface-${kind}`} aria-hidden="true">
      {kind === "terminal" && <>
        <span className="surface-pane-head">
          <span><i /><strong>powershell</strong><small>running</small></span>
          <SargamIcon src={moreIcon} />
        </span>
        <span className="surface-terminal-body">
          <code><b>PS</b> bun run test</code>
          <code className="passed">✓ 47 tests passed</code>
          <code><b>PS</b> git status --short</code>
          <code className="changed"> M apps/desktop/src/App.tsx</code>
          <code><b>PS</b> bun run build</code>
          <code className="passed">✓ built in 284ms</code>
          <code><b>PS</b> _</code>
        </span>
      </>}
      {kind === "agents" && <>
        <span className="surface-team-head"><span><strong>Team</strong><small>3 sessions</small></span><SargamIcon src={panelLeftIcon} /></span>
        <span className="surface-agent-list">
          <span className="surface-agent-row"><ProductAgentAvatar id="feature-codex" label="Codex" status="running" /><span><span><strong>Codex</strong><em>running</em></span><small>Review routing</small><i>Tracing current flow</i></span></span>
          <span className="surface-agent-row"><ProductAgentAvatar id="feature-claude" label="Claude Code" status="needs_input" /><span><span><strong>Claude Code</strong><em>needs input</em></span><small>Acceptance paths</small><i>Waiting for approval</i></span></span>
          <span className="surface-agent-row"><ProductAgentAvatar id="feature-opencode" label="OpenCode" status="completed" /><span><span><strong>OpenCode</strong><em>completed</em></span><small>Available</small></span></span>
        </span>
      </>}
      {kind === "ops" && <>
        <span className="surface-ops-toolbar"><span><SargamIcon src={dashboardIcon} /><strong>Plan</strong><small>4 tasks</small></span><span className="surface-ops-actions"><span className="surface-view-toggle"><small>View</small><b>Columns</b><i>List</i></span><em>0 agents</em><strong><SargamIcon src={addIcon} />New task</strong></span></span>
        <span className="surface-ops-board">
          <span className="surface-board-column"><span><strong>Ready</strong><small>1</small></span><span className="surface-task-card"><strong>Review routing</strong><small>Open the exact task context</small><em>normal priority</em></span></span>
          <span className="surface-board-column"><span><strong>Running</strong><small>2</small></span><span className="surface-task-card active"><strong>Wire task context</strong><small>Codex · tracing routes</small><span><ProductAgentAvatar id="ops-codex" label="Codex" status="running" /><em>01:42</em></span></span></span>
          <span className="surface-board-column"><span><strong>Review</strong><small>1</small></span><span className="surface-task-card"><strong>Acceptance paths</strong><small>Evidence ready</small><em>3 checks passed</em></span></span>
        </span>
      </>}
      {kind === "review" && <>
        <span className="surface-inspector-head"><span><strong>Review</strong><small>normal priority</small></span><b>Review routing</b><em>Open the exact task context before delivery.</em></span>
        <span className="surface-inspector-body">
          <span className="surface-inspector-section"><span><strong>Execution</strong><small>02:14</small></span><span className="surface-inspector-pair"><i>Owner</i><b>Codex</b><i>Reviewer</i><b>Human approval</b></span></span>
          <span className="surface-inspector-section"><span><strong>Delegation contract</strong></span><span className="surface-contract-row"><i>Definition of done</i><b>Review route opens the exact task context</b></span><span className="surface-contract-row"><i>Verification</i><code>bun run test</code></span></span>
          <span className="surface-inspector-section"><span><strong>Verification evidence</strong><small>3/3</small></span><span className="surface-inspector-checks"><i>✓ Acceptance criteria</i><i>✓ 47 tests passed</i><i>✓ Changed files reviewed</i></span></span>
        </span>
      </>}
      {kind === "bots" && active && <Suspense fallback={null}><BotsFeatureSurface
        releaseAvatar={<ProductAgentAvatar id="bot-release" label="Release verifier" status="completed" />}
        researchAvatar={<ProductAgentAvatar id="bot-research" label="Research scout" status="running" />}
      /></Suspense>}
    </span>
  );
}

function PlanCard() {
  return (
    <div className="card-surface mini-app-surface mini-contract-surface" aria-hidden="true">
      <MiniOpsToolbar />
      <div className="mini-task-composer">
        <span className="mini-field"><small>Title</small><strong>Review routing</strong></span>
        <span className="mini-field mini-objective"><small>Objective</small><strong>Open the exact task context before delivery</strong></span>
        <span className="mini-toolbar-button"><SargamIcon src={addIcon} />Create contract</span>
      </div>
      <div className="mini-contract-panel">
        <div className="mini-contract-title"><span>Delegation contract</span><small>Task worktree</small></div>
        <div className="mini-contract-grid">
          <span className="mini-contract-field"><small>Definition of done</small><strong>Review route opens the exact task context</strong></span>
          <span className="mini-contract-field"><small>Constraints</small><strong>Preserve local state. No unrelated refactor.</strong></span>
          <span className="mini-contract-field"><small>Verification command</small><code>bun run test</code></span>
          <span className="mini-contract-field"><small>Review policy</small><strong>Human approval</strong></span>
        </div>
        <div className="mini-dependency-row"><small>Dependencies</small><span><i />Task context</span><span><i />Acceptance paths</span></div>
      </div>
    </div>
  );
}

function RunCard() {
  return (
    <div className="card-surface mini-app-surface mini-ops-surface" aria-hidden="true">
      <MiniOpsToolbar />
      <div className="mini-ops-layout">
        <div className="mini-board-viewport">
          <div className="mini-board">
            <section className="mini-board-column">
              <header><strong>Ready</strong><small>0</small></header>
              <span className="mini-column-empty">Queue clear</span>
            </section>
            <section className="mini-board-column active">
              <header><strong>Running</strong><small>1</small></header>
              <article className="mini-task-card running">
                <span className="mini-workspace-badge">Task worktree</span><strong>Review routing</strong>
                <div className="mini-runtime"><span><i />In progress</span><code>01:42</code></div>
                <div className="mini-task-agent"><ProductAgentAvatar id="codex-workflow" label="Codex" status="running" /><span><strong>Codex</strong><small>Tracing review state</small></span></div>
                <div className="mini-task-note"><small>Update</small><span>Reading ParitySurfaces.tsx</span></div>
                <footer><span><SargamIcon src={playIcon} />Redirect</span><SargamIcon src={moreIcon} /></footer>
              </article>
            </section>
            <section className="mini-board-column">
              <header><strong>Verifying</strong><small>1</small></header>
              <article className="mini-task-card"><span className="mini-workspace-badge">Task worktree</span><strong>Acceptance paths</strong><div className="mini-verification"><span>Verification</span><strong>3/3</strong><i /></div><footer><span>Review evidence</span><small>Ready</small></footer></article>
            </section>
          </div>
        </div>
        <aside className="mini-agent-rail">
          <header><span><small>Team</small><strong>3 connected</strong></span><SargamIcon src={panelLeftIcon} /></header>
          <div className="mini-agent-row"><ProductAgentAvatar id="codex-rail" label="Codex" status="running" /><span><strong>Codex</strong><small>Review routing</small></span></div>
          <div className="mini-agent-row"><ProductAgentAvatar id="claude-rail" label="Claude Code" status="needs_input" /><span><strong>Claude Code</strong><small>Needs input</small></span></div>
          <div className="mini-agent-row"><ProductAgentAvatar id="opencode-rail" label="OpenCode" status="completed" /><span><strong>OpenCode</strong><small>Available</small></span></div>
        </aside>
      </div>
    </div>
  );
}

function ReviewCard() {
  return (
    <div className="card-surface mini-app-surface mini-review-surface" aria-hidden="true">
      <div className="mini-review-underlay">
        <MiniOpsToolbar />
        <div className="mini-review-board-hint"><span /><span /><span /></div>
      </div>
      <aside className="mini-review-drawer">
        <header><strong>Task review</strong><p>Inspect agent handoff and repository evidence before approval.</p></header>
        <div className="mini-review-body">
          <section className="mini-review-card">
            <div><strong>Review routing</strong><small>Open the exact task context before delivery.</small></div>
            <span className="mini-review-label">Verification command</span><code>bun run test</code>
          </section>
          <section className="mini-review-card">
            <div><strong>Verification run</strong><small className="passed">Passed · exit 0</small></div>
            <div className="mini-review-meta"><code>47 tests</code><code>snapshot 8f31c2</code></div>
          </section>
          <section className="mini-review-card">
            <div><strong>Repository evidence</strong><span className="mini-workspace-badge">Task worktree</span></div>
            <small>2 changed files · clean worktree</small>
            <div className="mini-file-row"><SargamIcon src={codeIcon} /><code>ParitySurfaces.tsx</code><span>+18 <del>−4</del></span></div>
            <div className="mini-file-row"><SargamIcon src={codeIcon} /><code>App.test.ts</code><span>+9 <del>−0</del></span></div>
          </section>
        </div>
        <footer><span>Review changes</span><strong><SargamIcon src={checkIcon} />Approve verification</strong></footer>
      </aside>
    </div>
  );
}

function MiniOpsToolbar() {
  return (
    <div className="mini-ops-toolbar">
      <span className="mini-breadcrumb"><SargamIcon src={dashboardIcon} /><strong>Plan</strong><small>4 tasks</small></span>
      <span className="mini-view"><small>View</small><i className="active">Columns</i><i>List</i></span>
      <span className="mini-plan-actions"><span className="mini-agents">0 agents</span><span className="mini-new-task"><SargamIcon src={addIcon} />New task</span></span>
    </div>
  );
}

function DownloadSection() {
  return (
    <section className="download-section" id="download" aria-labelledby="download-title">
      <DeferredPaperTexture
        className="download-texture"
        image={paperField}
      />
      <div className="download-grid page-width">
        <div className="download-copy">
          <img className="app-icon" src="/app-icon.png" alt="" />
          <p>Built for your machine · v{__WHEELJACK_VERSION__}</p>
          <h2 id="download-title">Your workspace is ready.</h2>
          <p className="download-deck">
            macOS builds are signed and notarized. Windows builds are currently unsigned.
            Workspace state stays local, and agent credentials stay with their CLIs.
          </p>
          <p className="download-requirement">Regular shells work immediately. Structured chat and managed Plan work require a supported coding-agent CLI installed and authenticated separately.</p>
          <div className="release-links" aria-label="Release resources">
            <a href={downloads.release}>Latest release</a>
            <a href={downloads.release}>Release notes</a>
            <a href={downloads.checksums}>SHA256 checksums</a>
          </div>
        </div>
        <div className="download-options">
          <DownloadOption
            platform="Windows"
            detail="Windows x64 · Portable EXE · Unsigned"
            href={downloads.windows}
          />
          <DownloadOption
            platform="macOS"
            detail="Apple silicon + Intel · Universal DMG · Signed & notarized"
            href={downloads.macos}
          />
          <article className="update-proof">
            <span><SargamIcon src={checkIcon} /></span>
            <div><strong>Updates include a recovery path.</strong><p>Check manually or automatically, follow verified progress, read release notes, and restart into an update. If the replacement does not report a healthy UI, wheeljack restores the previous app. Upgrading from v0.1.0 requires this one-time manual download; in-app updates work from v0.1.1 onward.</p></div>
          </article>
        </div>
      </div>
    </section>
  );
}

function DownloadOption({ platform, detail, href }: { platform: string; detail: string; href: string }) {
  const action: ReactNode = downloadsLive
    ? <a className="download-action" href={href}><span>Download</span><span className="action-icon"><Arrow /></span></a>
    : <span className="download-action disabled" aria-disabled="true"><span>Coming soon</span><span className="action-icon"><Arrow /></span></span>;

  return (
    <article className="download-option">
      <div><span>{platform}</span><small>{detail}</small></div>
      {action}
    </article>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="page-width">
        <a className="footer-brand" href="#top" aria-label="wheeljack home">
          <img src="/favicon.svg" alt="" />
          <span>wheeljack</span>
        </a>
        <p>Built for agent-first project work.</p>
        <span className="footer-links">
          <a href="https://github.com/bildhaus/wheeljack">GitHub</a> ·{" "}
          <a href="https://github.com/bildhaus/wheeljack/releases/latest">Releases</a> ·{" "}
          <a href="https://github.com/bildhaus/wheeljack/blob/main/LICENSE">License</a> ·{" "}
          <a href="https://github.com/bildhaus/wheeljack/blob/main/SECURITY.md">Security</a> ·{" "}
          <a href="https://github.com/bildhaus/wheeljack/blob/main/SUPPORT.md">Support</a> ·{" "}
          <a href="https://github.com/bildhaus/wheeljack/issues/new/choose">Report an issue</a> ·{" "}
          <a href="https://sketchfab.com/3d-models/heavy-metal-wheeljack-7f43f465554a48d3b40b3976aa658c82">3D credit</a>
        </span>
      </div>
    </footer>
  );
}
