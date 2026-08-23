---
title: Support and security
description: Choose the correct wheeljack support channel and report vulnerabilities without exposing private project or provider data.
editUrl: https://github.com/bildhaus/wheeljack/edit/main/docs/help/support-and-security.md
---

Use public GitHub Issues for reproducible wheeljack bugs and focused feature
requests. Use private vulnerability reporting for suspected security issues.

## Before opening a bug

Verify that:

- you are using the latest wheeljack release;
- the relevant agent CLI is installed, authenticated, and available on `PATH`;
- the same CLI starts successfully outside wheeljack; and
- the issue is not already reported.

[Open the issue chooser](https://github.com/bildhaus/wheeljack/issues/new/choose)
after collecting a minimal safe reproduction.

Provider authentication, subscriptions, rate limits, billing, model output, and
upstream outages are owned by the provider. wheeljack issues should focus on
adapter discovery, launch, protocol handling, terminal behavior, local state,
routing, updates, or desktop integration.

## Report a vulnerability privately

Do not open a public issue for a suspected vulnerability. Use
[GitHub private vulnerability reporting](https://github.com/bildhaus/wheeljack/security/advisories/new).
If that option is unavailable, contact a Bildhaus maintainer privately through a
published contact channel without including exploit details publicly.

Include:

- affected wheeljack version and operating system;
- the security boundary involved;
- minimal reproduction steps or proof of concept;
- expected impact; and
- any known mitigation.

Remove credentials, provider tokens, private transcripts, and unrelated project
data. No response-time SLA is promised for this pre-1.0 project.

## Security-sensitive boundaries

- project path validation and file writes;
- terminal and child-process isolation;
- agent approval, sandbox, access, and autonomy enforcement;
- transcript, settings, attachments, and SQLite persistence;
- update download, checksum, replacement, health, and rollback; and
- CI signing and release credentials.

Security fixes target the latest released `0.x` version. Older versions may not
receive backports.
