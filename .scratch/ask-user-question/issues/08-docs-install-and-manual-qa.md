# 08 - Docs, install flow, and full manual QA

**What to build:** the release-ready package.
A README explains what the tool does, how to install it from a local path or a git URL, and how the model uses it.
Docs use the glossary vocabulary from CONTEXT.md.
A manual QA pass exercises every user-facing path in a live pi session.

**Blocked by:** 03, 04, 05, 06, 07.

**Status:** ready-for-agent

- [ ] The README covers install, usage, the Answer format, and the TUI-only limitation (ADR 0001).
- [ ] A fresh `pi install` from a clean checkout loads the extension with zero configuration.
- [ ] Manual QA covers single-select, Other, multiSelect, four-Question Asks, cancel, abort, serialization, and transcript rendering.
- [ ] QA findings that look off get fixed, not logged.
- [ ] Lint, typecheck, and the full test suite run green.
