# 01 - Package scaffold and registered-tool seam

**What to build:** a pi package that registers `ask_user_question` with the full parity schema.
After `pi install`, the tool appears in the tool list with its prompt snippet.
A call outside the TUI returns the no-interactive-user error, so the model proceeds on its own.
Inside the TUI the tool runs the Effect program against a stub AskUI Layer and returns Answer lines.
This is the walking skeleton: no real UI yet, but the whole path is testable at the seam.

**Blocked by:** None - can start immediately.

**Status:** ready-for-agent

- [ ] Git repo initialized, work on a feature branch, never on the default branch.
- [ ] Bun, TypeScript, Effect, and Vitest are set up, and `bun run test` runs green.
- [ ] The package installs with a local path source and pi lists the extension.
- [ ] The extension factory accepts an optional AskUI Layer override (ADR 0002).
- [ ] The TypeBox schema enforces one to four Questions, two to four Options, and the twelve-character Header bound.
- [ ] `promptSnippet` and `promptGuidelines` name `ask_user_question`.
- [ ] Outside TUI mode the tool throws, and the error text tells the model no interactive user is available (ADR 0001).
- [ ] Seam tests drive a fake ExtensionAPI and a scripted stub Layer through success, cancel, and non-TUI paths.
- [ ] Success results contain header-and-answer lines and structured `details`.
