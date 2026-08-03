# pi-ask-user-question

`pi-ask-user-question` gives pi agents a structured way to ask users for decisions.
The extension registers an `ask_user_question` tool and opens each Ask inside the pi TUI.

One Ask contains one to four Questions.
Each Question contains a Header, two to four Options, and an automatic Other row.
Questions can accept one Option or several Options through `multiSelect`.

## Requirements

- pi `0.83.0` or later
- A real interactive terminal

Review package source before installation.
Pi extensions run with full system access.

## Install

Install dependencies once in a fresh local checkout:

```sh
bun install
```

Then install the local checkout during development:

```sh
pi install ./path/to/pi-ask-user-question
```

Add `-l` to keep the package in project settings instead of user settings:

```sh
pi install -l ./path/to/pi-ask-user-question
```

Install from GitHub:

```sh
pi install git:github.com/jyooi/pi-ask-user-question
```

Pi reads the package manifest and loads `src/index.ts` without extension configuration.
Run `pi list` to confirm the package source.

## Usage

Start pi in interactive mode after installation.
The agent can call `ask_user_question` when it needs a choice among clear Options.

A tool call uses this shape:

```json
{
  "questions": [
    {
      "header": "Runtime",
      "question": "Which runtime should this package use?",
      "multiSelect": false,
      "options": [
        {
          "label": "Bun",
          "description": "Use Bun for scripts and dependencies."
        },
        {
          "label": "Node",
          "description": "Use Node and npm for package tasks."
        }
      ]
    }
  ]
}
```

A Header can contain at most twelve characters.
Every Question requires two to four Options.
The UI adds Other, so the model must not include it in `options`.

## Controls

The help line shows bindings from the active pi keybinding configuration.
Custom bindings replace the displayed defaults and control the Ask immediately.

| Action | Default binding | Behavior |
| --- | --- | --- |
| Move | `up`, `down` | Move between Options and Other. |
| Read | `pageUp`, `pageDown` | Read wrapped Question, Option, and help content. |
| Select or confirm | `enter` | Select one Option or confirm toggled Options. |
| Toggle | `space` | Toggle an Option in a `multiSelect` Question. |
| Open Other | `enter` | Open free-text entry on the Other row. |
| Submit Other | `enter` | Submit a non-empty free-text Answer. |
| Leave Other | `escape`, `ctrl+c` | Return to the Option list without an Answer. |
| Cancel Ask | `escape`, `ctrl+c` | Decline the whole Ask from the Option list. |
| Previous Question | `left`, `ctrl+b` | Revisit the previous answered Question. |
| Next Question | `right`, `ctrl+f` | Move toward the next unanswered Question. |

Selection, confirmation, cancellation, submission, reading, and Question navigation use resolved pi keybindings.
The `multiSelect` toggle always uses `space`.

A single-select Other Answer excludes every listed Option.
A `multiSelect` Other Answer preserves all toggled Labels and adds the free-text Answer.
Confirmation requires at least one toggled Option, Other text, or both.

Escape inside Other returns to the Option list.
Escape from the Option list cancels the entire Ask, including any earlier Answers.
An agent turn abort also dismisses the open Ask and returns a declined result.

For a multi-Question Ask, the UI advances to the first unanswered Question.
The user can revisit an answered Question before the final Answer.

Long content fits the available terminal height.
The move bindings change the highlighted row, while the read bindings page through wrapped content.

## Answer format

A successful result contains one Header and Answer line per Question:

```text
Runtime: Bun
Checks: Lint, Types, "Run security scans" (other)
```

Chosen Labels use comma separators.
Other text uses JSON quotes and an `(other)` marker.
A `multiSelect` Answer can contain Labels and Other text on the same line.

The structured `details.answers` array preserves Question order.
Each entry contains `header`, `question`, `selectedLabels`, and optional `otherText` fields.

Concurrent Asks use a session queue.
The TUI presents one Ask at a time and starts the next Ask after the current Ask closes.

The transcript renderer shows Header chips, Question text, and resolved Answers instead of raw tool JSON.

## TUI-only limitation

`ask_user_question` works only in pi TUI mode.
RPC, JSON, print, and other headless modes return a clear no-user error.
The extension does not provide a reduced RPC dialog or a default Answer.

See [ADR 0001](docs/adr/0001-tui-only-no-rpc-fallback.md) for this decision.
See [ADR 0002](docs/adr/0002-effect-core-with-askui-service.md) for the AskUI service design.

## Terminal safety

Model-provided display text passes through a terminal sanitization boundary.
The boundary removes ANSI, C1, and other terminal control sequences before TUI or transcript output.
It also converts tabs, newlines, and carriage returns to spaces.

This boundary covers Headers, Question text, Option Labels, Option Descriptions, and displayed Answer text.
Structured result details retain the original model values.

## Development

Install dependencies and run all checks:

```sh
bun install
bun test
bun run lint
bun run typecheck
```

See [Manual QA](docs/manual-qa.md) for the release verification record.
