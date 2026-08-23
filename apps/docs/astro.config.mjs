import sitemap from "@astrojs/sitemap";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

const site = "https://docs.wheeljack.dev";

export default defineConfig({
  site,
  output: "static",
  integrations: [
    sitemap({ filter: (page) => !page.endsWith("/404/") }),
    starlight({
      title: "wheeljack docs",
      description: "Install, configure, and use the wheeljack local-first workspace for coding agents.",
      disable404Route: true,
      favicon: "/favicon.svg",
      logo: {
        src: "./src/assets/wheeljack-lockup.svg",
        alt: "wheeljack",
        replacesTitle: true,
      },
      social: [
        { icon: "github", label: "wheeljack on GitHub", href: "https://github.com/bildhaus/wheeljack" },
      ],
      editLink: {
        baseUrl: "https://github.com/bildhaus/wheeljack/edit/main/docs/",
      },
      lastUpdated: true,
      customCss: [
        "@fontsource-variable/geist",
        "@fontsource-variable/jetbrains-mono",
        "@fontsource/geist-pixel/400.css",
        "./src/styles/custom.css",
      ],
      markdown: {
        processedDirs: ["../../docs"],
      },
      sidebar: [
        { slug: "index", label: "Overview" },
        {
          label: "Getting started",
          items: [
            { slug: "getting-started/installation" },
            { slug: "getting-started/first-project" },
            { slug: "getting-started/connect-agents" },
          ],
        },
        {
          label: "Guides",
          items: [
            { slug: "guides/workspaces-and-panes" },
            { slug: "guides/structured-agents" },
            { slug: "guides/plan-and-review" },
            { slug: "guides/bots" },
            { slug: "guides/settings-and-shortcuts" },
            { slug: "guides/updates-and-recovery" },
          ],
        },
        {
          label: "Reference",
          items: [
            { slug: "reference/local-data-and-permissions" },
            { slug: "reference/architecture" },
            { slug: "reference/agent-adapters" },
          ],
        },
        { slug: "contributing" },
        {
          label: "Help",
          items: [
            { slug: "help/troubleshooting" },
            { slug: "help/support-and-security" },
          ],
        },
      ],
      head: [
        { tag: "meta", attrs: { property: "og:site_name", content: "wheeljack docs" } },
        { tag: "meta", attrs: { property: "og:type", content: "website" } },
        { tag: "meta", attrs: { property: "og:image", content: `${site}/og-wheeljack.png` } },
        {
          tag: "meta",
          attrs: {
            property: "og:image:alt",
            content: "wheeljack desktop workspace with split terminals, coding agents, and Plan review lanes",
          },
        },
        { tag: "meta", attrs: { name: "twitter:card", content: "summary_large_image" } },
        { tag: "meta", attrs: { name: "twitter:image", content: `${site}/og-wheeljack.png` } },
        {
          tag: "script",
          attrs: { type: "application/ld+json" },
          content: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: "wheeljack docs",
            url: `${site}/`,
            description: "Documentation for the wheeljack local-first desktop workspace for coding agents.",
            publisher: {
              "@type": "Organization",
              name: "bildhaus",
              url: "https://github.com/bildhaus",
            },
          }),
        },
      ],
    }),
  ],
  vite: {
    build: {
      sourcemap: false,
    },
  },
});
