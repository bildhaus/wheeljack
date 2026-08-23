# Docs Lighthouse record

This record captures a local mobile Lighthouse run against the production
Astro output. It is a regression snapshot, not a claim about production speed;
network distance, Cloudflare caching, client hardware, and browser conditions
will change field performance.

## 2026-08-23

- Build: `bun run build`, served with `bun run preview`
- Browser: Google Chrome 151.0.7922.170, headless mobile emulation
- Lighthouse: 13.4.1

| Route | Performance | Accessibility | Best practices | SEO | FCP | LCP | TBT | CLS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `/` | 98 | 100 | 100 | 100 | 1.4 s | 1.7 s | 0 ms | 0.086 |
| `/reference/architecture/` | 99 | 100 | 100 | 100 | 1.7 s | 2.0 s | 0 ms | 0.004 |

Run the same categories with:

```powershell
$env:CHROME_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
bunx lighthouse http://127.0.0.1:4321/ `
  --quiet `
  --form-factor=mobile `
  '--only-categories=performance,accessibility,best-practices,seo' `
  --output=json `
  --output-path=artifacts/docs-lighthouse-home.json `
  --chrome-flags="--headless --disable-gpu --no-sandbox"
```

Keep generated reports under `artifacts/`; that directory is intentionally
ignored by Git.
