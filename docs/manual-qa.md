# Manual QA

Date: 2026-08-03

Result: pass

## Environment

- pi `0.83.0`
- Runtime QA commit `ef503b4`
- Release candidate parent `e5aa509`
- Model `openai-codex/gpt-5.6-sol`
- Tmux PTY at `100x30`
- Tight viewport at `18x8`

All interaction used real pi TUI sessions from the ticket worktree.
The sessions loaded the installed package through pi package discovery.
No session used `--extension` for the package under test.

QA-only helper extensions triggered host abort and hostile display text.
Those helpers stayed under the ignored `.pi/qa-08` directory.

## Install verification

### Git source

The command below used an empty `PI_CODING_AGENT_DIR`:

```sh
pi install git:github.com/jyooi/pi-ask-user-question@ef503b4
```

Pi cloned the source, checked out `ef503b4`, and installed four production packages.
`pi list` showed the pinned git source.
The installed checkout contained `node_modules/effect`.
A new TUI session listed `jyooi/pi-ask-user-question:src` under Extensions.
No extension configuration or extension flag was required.

### Local project source

The command below ran from a new local driver directory:

```sh
pi install -l /path/to/pi-ask-user-question
```

Pi wrote a relative package source to the driver project settings.
`pi list --approve` showed the project package and its resolved source path.
A new TUI session listed `src` under Extensions.
This check confirmed project scope and zero extension configuration.

## Observed scenarios

### Single-select and transcript

The Runtime Question showed Bun, Node, their Descriptions, and Other.
The help line showed resolved default move, read, select, and cancel bindings.
Down highlighted Node, and Enter selected it.

The transcript call showed the Runtime Header chip and Question text.
The transcript result showed `Runtime: Node` without raw JSON.
Session details stored `selectedLabels: ["Node"]` without `otherText`.

Result: pass

### multiSelect with Other

Space toggled Lint and changed its marker from `[ ]` to `[x]`.
Down moved the highlight to Other.
Enter opened free-text entry.
The submitted text was `Run security scans`.

The final Answer preserved the toggled Label:

```text
Checks: Lint, "Run security scans" (other)
```

Session details stored `selectedLabels: ["Lint"]` and `otherText: "Run security scans"`.

Result: pass

### Four-Question Ask

One Ask contained Runtime, Deploy, Tests, and Theme Questions.
All four Header chips stayed visible as the active Question changed.
The TUI advanced to the first unanswered Question after each Answer.

The selected Answers were Bun, Cloud, Commit, and Dark.
The result kept Question order:

```text
Runtime: Bun
Deploy: Cloud
Tests: Commit
Theme: Dark
```

Result: pass

### Question navigation

A separate two-Question Ask displayed resolved previous and next bindings.
Left returned from Nav2 to the answered Nav1 Question.
Right returned to the unanswered Nav2 Question.
The final result contained `Nav1: Bun` and `Nav2: Local`.

Result: pass

### Cancellation

Other accepted the temporary text `Discarded`.
Escape returned to the Option list and removed that text.
A second Escape canceled the whole Ask.

Pi returned this error to the model:

```text
The user declined this Ask. Do not repeat ask_user_question immediately. Continue using your own judgment.
```

No partial Answer appeared.

Result: pass

### Host abort

A QA-only extension called the real `ctx.abort()` after the Abort Ask opened.
The open component disappeared without user input.
The tool returned the same declined Ask error.
Pi then reported the interrupted operation and restored editor input.

A second Ask opened in the same pi process.
Enter selected Recovery Yes, which proved that stale UI state did not remain.

Result: pass

### Serialized Asks

One assistant message contained two parallel `ask_user_question` calls.
Session JSONL confirmed two tool calls in that message, with Runtime and Package Headers.

Only Runtime appeared as the interactive Ask at first.
Package appeared after Runtime closed with Node.
Package then closed with Library.
No two Ask components appeared together.

Result: pass

### Resolved keybindings

A fresh TUI session used custom `k`, `j`, `u`, `d`, `y`, and `x` bindings.
The help line showed `move k / j`, `read u / d`, `select y`, and `cancel x`.
The `j` key highlighted Beta.
The `y` key selected Beta.
The result showed `Keys: Beta`.

Result: pass

### Tight viewport

The Viewport Ask was resized from `100x30` to `18x8`.
The Ask stayed above the pi status area.
The active Header, Question context, highlighted Option, help, border, and status shared the narrow viewport.

Down moved the highlight from Alpha to Beta.
It did not scroll the selected Option text.
Repeated Page Down presses reached every wrapped Question fragment.
Later presses reached the full Beta Description and every help fragment.

Other text entry remained visible at `18x8`.
The terminal then returned to `100x30` without stale layout state.
The result showed `Viewport: "Use Deno" (other)`.

Result: pass

### Terminal sanitization

A QA-only `tool_call` hook injected OSC and CSI control text.
The live Ask displayed Run, Choose safely, Bun, and Fast runtime.
No hostile payload appeared in the captured raw TUI stream.
The result text showed `Run: Bun`.

Session details retained the original model values and their control sequences.
This observation confirmed a display boundary without data corruption.

Result: pass

## Automated checks

The registered-tool suite covers non-TUI errors and schema bounds.
It also covers cancellation, abort cleanup, serialization, sanitization, transcript rendering, and viewport edge cases.

The release candidate parent ran after the manual pass.
Vitest returned 45 passing tests, zero failures, and 198 assertions.
Biome checked ten files without diagnostics.
TypeScript returned zero errors.

For the current package checks, see [Development](../README.md#development).
