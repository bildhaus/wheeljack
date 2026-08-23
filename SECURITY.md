# Security policy

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private
vulnerability reporting for this repository. If that option is unavailable,
contact a Bildhaus maintainer privately through a published contact channel
without including exploit details in a public message.

Public reporting guidance is also available at
[docs.wheeljack.dev](https://docs.wheeljack.dev/help/support-and-security/).

Include:

- the affected wheeljack version and operating system;
- the security boundary involved;
- minimal reproduction steps or a proof of concept;
- the expected impact; and
- any known mitigation.

Remove credentials, provider tokens, private transcripts, and unrelated
project data. Maintainers will acknowledge the report, investigate it, and
coordinate disclosure after a fix is available. No response-time SLA is
promised for this pre-1.0 project.

## Scope

Security-sensitive areas include:

- project path validation and file writes;
- terminal and child-process boundaries;
- agent approval, sandbox, and autonomy enforcement;
- transcript, settings, and SQLite persistence;
- update download, checksum, installation, health, and rollback behavior; and
- CI signing and release credentials.

Provider CLI vulnerabilities, provider account access, billing, model behavior,
and upstream service availability should also be reported to the relevant
provider.

## Supported versions

Security fixes target the latest released `0.x` version. Older releases may not
receive backports. Users should update to the newest verified release before
reporting an issue that is already fixed there.
