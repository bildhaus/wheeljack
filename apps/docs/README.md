# wheeljack docs

The public documentation at `docs.wheeljack.dev` is a static Astro Starlight
site. Canonical content lives in the repository-level `docs/` directory; this
package owns rendering, branding, validation, and deployment configuration.

## Run locally

```powershell
Push-Location apps\docs
bun install --frozen-lockfile
bun run dev
Pop-Location
```

Use `bun run build` before opening a pull request. It type-checks the Astro
project, builds every route, and validates generated metadata and internal
links. Use `bun run preview` to inspect the production output locally.

## Authoring

- Add Markdown or MDX under `docs/`; folders become URL segments.
- Every public page needs unique `title` and `description` frontmatter plus an
  `editUrl` targeting its source file under `main/docs/`.
- Starlight renders the page H1 from `title`; start body sections at H2.
- Keep instructions accurate for the latest public release. Mark unreleased
  behavior explicitly instead of presenting it as available.
- Use separate Windows and macOS headings or tabs for platform-specific steps.
- Use repository-relative links for source material and root-relative links for
  public documentation routes.
- Put permission-expanding, destructive, and recovery-sensitive guidance in a
  visible warning or caution aside.

External documentation contributions should target `main`.

The latest local mobile audit and its reproducible command are recorded in
[`LIGHTHOUSE.md`](./LIGHTHOUSE.md).
