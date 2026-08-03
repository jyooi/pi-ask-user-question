---
title: ask_user_question pi extension
labels: [ready-for-agent]
status: open
created: 2026-08-03
---

# Spec: ask_user_question pi extension

## Problem Statement

When a pi agent needs a decision from the user, it can only ask in plain prose.
The user must read a wall of text, understand the alternatives, and type an answer by hand.
Claude Code solves this with the AskUserQuestion tool, which shows structured choices and a free-text escape hatch.
Pi has no equivalent, so decision points in pi sessions are slower and more error-prone.

## Solution

A pi package that registers an `ask_user_question` tool.
The tool mirrors the schema and behavior of Claude Code's AskUserQuestion.
One Ask carries one to four Questions.
Each Question shows a Header chip, question text, two to four Options with descriptions, and an automatic Other row for free text.
The user answers in a pi-tui component, and the model receives compact header-and-answer lines.
The vocabulary for Ask, Question, Header, Option, Other, Answer, and AskUI is defined in CONTEXT.md.

## User Stories

1. As a pi user, I want the agent to ask me structured questions with selectable Options, so that I answer decisions quickly without typing prose.
2. As a pi user, I want each Option to show a description, so that I understand the trade-offs before I choose.
3. As a pi user, I want an Other row on every Question, so that I can give a custom answer when no Option fits.
4. As a pi user, I want multiSelect Questions, so that I can pick several non-exclusive choices at once.
5. As a pi user, I want up to four Questions in one Ask, so that related decisions arrive together.
6. As a pi user, I want a Header chip on each Question, so that I see the topic of each decision at a glance.
7. As a pi user, I want to cancel the whole Ask with Escape from the Option list, so that I can decline without answering any part of it.
8. As a pi user, I want readable transcript rendering of each Ask, so that I can review past decisions.
9. As a pi user, I want an aborted agent turn to dismiss an open Ask, so that no stale dialog blocks the editor.
10. As a model, I want a tool schema identical in shape to AskUserQuestion, so that my calls validate on the first try.
11. As a model, I want Answers returned as one line per Question, so that I parse the result without ambiguity.
12. As a model, I want free-text Other Answers marked as such, so that I can tell a custom answer from a listed Option.
13. As a model, I want a clear error when the user declines, so that I proceed with my own judgment instead of repeating the Ask.
14. As a model, I want a clear error when no interactive user exists, so that I do not wait for an answer that cannot come.
15. As a model, I want the tool described in the system prompt, so that I know when to reach for it.
16. As an extension consumer, I want to install the package from a git URL or a local path, so that setup is one command.
17. As an extension consumer, I want the extension to load with zero configuration, so that the tool works immediately after install.
18. As a test author, I want to inject a stub AskUI Layer through the extension factory, so that I test the full tool without a terminal.
19. As a test author, I want typed errors for cancel and missing UI, so that I assert failure modes precisely.
20. As a maintainer, I want the terminal code isolated in one production Layer, so that UI changes do not touch flow logic.

## Implementation Decisions

- The deliverable is a standalone pi package repo, installable with `pi install ./path` or `pi install git:...` (per the packaging decision in the grilling session).
- Language is TypeScript with Effect as the standard library. Runtime tooling is bun.
- The tool name is `ask_user_question`, in snake_case beside pi's built-in tools.
- The tool `parameters` schema uses TypeBox, because pi validates tool arguments with TypeBox (ADR 0002).
- The schema mirrors AskUserQuestion: `questions` array of one to four items. Each item has `header` (max twelve characters), `question`, `multiSelect`, and `options` (two to four items with `label` and `description`). Enforce bounds with TypeBox constraints (`minItems`, `maxItems`, `maxLength`).
- The Other row is a UI construct that the component appends to every Question. It is not part of the schema.
- The core flow is an Effect program with typed errors `UserCancelled` and `NoInteractiveUI` (ADR 0002).
- All terminal interaction sits behind an `AskUI` service tag. The production Layer renders a custom pi-tui component through `ctx.ui.custom()`. The extension factory accepts an optional AskUI Layer override for tests.
- The tool is TUI-only (ADR 0001). Outside `ctx.mode === "tui"` it throws, and the error text tells the model that no interactive user is available.
- Canceling an Ask is all-or-nothing, and the tool result is an error that tells the model the user declined and not to repeat the Ask immediately. Tickets 02, 03, and 05 own Escape behavior for Option lists, Other text entry, and multi-Question Asks.
- On success, text content contains one Header and Answer line per Question.
- Chosen Labels use comma separators.
- Other text appears quoted with an `(other)` marker.
- A multiSelect Answer can contain chosen Labels and Other text together.
- Other remains exclusive for a single-select Question.
- Result `details` preserve chosen Labels as an array and optional Other text.
- Pi runs tool calls in parallel by default, so concurrent Asks must serialize. A per-session queue shows one Ask at a time.
- Pi's `AbortSignal` maps to Effect interruption. An abort dismisses the open component and resolves as a declined Ask.
- The tool defines `promptSnippet` and `promptGuidelines`, and each guideline names `ask_user_question` explicitly.
- The tool defines custom `renderCall` and `renderResult`, so the transcript shows Header chips and Answers instead of raw JSON.
- No dialog timeout. The Ask waits until the user answers or cancels.
- multiSelect confirmation needs at least one selected Option or an Other answer.

## Testing Decisions

- Tests run with Vitest and assert external behavior only: result text, `details` shape, error flags, and error messages. They never inspect internal state or private functions.
- The single seam is the registered tool. Tests call the extension factory with a fake ExtensionAPI, capture the `ask_user_question` registration, and call `execute()` with a fake ctx and a stub AskUI Layer.
- The stub Layer is scripted per test: it returns fixed Answers, simulates Other input, or raises `UserCancelled`.
- Covered paths: single Question, multiple Questions, multiSelect, Other answers, cancel, non-TUI mode error, schema bound violations, and serialization of two concurrent Asks.
- The pi-tui component below the seam gets manual QA in a live pi session.
- Existing examples: none, this is a fresh repo. Pi's bundled example extensions serve as reference for the fake ExtensionAPI shape.

## Out of Scope

- RPC-mode fallback dialogs (rejected in ADR 0001).
- Headless auto-answer or default answers in print/JSON mode.
- npm publishing and release automation. Git install is enough for now.
- Dialog timeouts and countdown dismissal.
- Persistence of Answers outside the normal session transcript.
- Overriding or replacing any built-in pi tool.
- Localization of UI text.

## Further Notes

- CONTEXT.md defines the ubiquitous language. Use Ask, Question, Header, Option, Other, Answer, and AskUI in code and docs.
- ADR 0001 (TUI only) and ADR 0002 (Effect core with AskUI service) bind this spec.
- The repo has no git history yet. Initialize git before implementation and work on a feature branch, never on the default branch.
- Claude Code renders a side-by-side preview panel for options with previews. That feature is not in the parity scope because AskUserQuestion previews are not part of its public input schema for other agents. Revisit if pi users ask for it.
