---
name: verify-ask-lifecycle
description: Model-check the Ask lifecycle of ask_user_question with TLC, and add the state chart file of each PR. Use when a change touches src/index.ts or src/live-ask-ui.ts, when you open a PR, or when bun run verify fails.
---

# Verify the Ask lifecycle

An Ask lifecycle is the path of one `ask_user_question` call from the tool call to its return.
The call waits for its turn in the queue, shows its Ask, and returns Answers, the declined error, or an error.
Pi runs the tool calls of one turn in parallel, and the user can abort the turn at any time.
`AskLifecycle.tla` is a TLA+ model of those events, and TLC checks every order of them within the bounds below.

## Why this target and this tool

The Ask lifecycle is the code where an error costs most in this repository.
A fault here hangs the agent turn, covers one Ask with a second Ask, or leaves a stale Ask on the editor.
The seam tests use a stub AskUI Layer, or a fake `ui.custom`, and each test checks one order of events.
The faults come from orders that the tests do not reach, such as an abort while a second Ask waits in the queue.

The question is about the order of events, so a model checker fits it.
TLC is the standard model checker for TLA+, and it runs on Java with one pinned JAR file.
The navigation between Questions inside one Ask has more states, but each fault there shows in one test.

## Run the check

```sh
bun run verify
```

The check needs Java 11 or later on the `PATH`.
The first run downloads TLC 1.7.4 into `node_modules/.cache/tla2tools/1.7.4/` and compares its SHA-256 with `record.json`.
The `verify` job of `.github/workflows/verification.yml` runs the same command on each PR.
The `test` command of `.no-mistakes.yaml` also runs it.

The check fails in each of these cases, and it names the cause:

1. This skill or `record.json` is missing.
2. A covered file or a model file changed, and its SHA-256 in `record.json` did not.
3. TLC finds a violation of a property with the status `holds`, or a recorded finding no longer breaks.
4. TLC does not catch the recorded break of a property with the status `holds`.
5. The change adds or changes no state chart file with the name of the branch.
6. A state chart file has no Mermaid chart and no "No state change" note.
7. A state chart file has a Mermaid chart, and no SVG image is beside it.
8. The SVG image names a chart digest that is not the digest of the chart text.

The check finds the change from the merge base of `HEAD` and `origin/main` to `HEAD`.
It reads the committed chart files, so commit the chart file and its image before you run it.
It does not check cases 5 to 8 when `HEAD` has no change from `origin/main`, for example on `main`.
In CI, the check gets the branch name from `GITHUB_HEAD_REF`.
On a detached `HEAD` with no branch name, the check accepts any chart file that the change adds or changes.

## Tell if a change touches verified code

`record.json` lists each covered file, the functions in it, and its SHA-256.
The check compares the full file, so any edit of a covered file stops the check until you confirm the model.
Also look for new code that changes the same behavior in other files.
Examples are a new caller of `ui.custom`, a second semaphore, or a new path that returns from `executeAsk`.

| Covered file | Code that the model describes |
| --- | --- |
| `src/index.ts` | `askProgram`, `executeAsk`, and the `askSemaphore` of `createAskUserQuestionExtension` |
| `src/live-ask-ui.ts` | `createLiveAskUILayer`, and the `done` calls of `AskComponent.answerQuestion` |

## Properties

| Property | Status | Rule in plain words | Harm when it breaks |
| --- | --- | --- | --- |
| `OneAskAtATime` | holds | The user sees at most one open Ask at a time. | A second Ask covers the first, and the first call waits for an Answer that the user cannot give. |
| `NoStaleAsk` | holds | When a call returns, its Ask is closed. | After an abort, a stale Ask stays on the editor. |
| `WaitingCallHasAsk` | holds | While a call waits for an Answer, its Ask is on the screen. | The turn hangs with no Ask to answer, and each later Ask waits behind it. |
| `DeclineIsClear` | holds | When the user presses Escape or the turn aborts, a call without Answers returns the declined error. | The model gets a raw error, does not know that the user declined, and can ask again at once. |

A property can have the status `finding`.
It then breaks on the current code, the check expects it to break, and the check fails when it stops breaking.
No property has this status now.

Each property with the status `holds` has a recorded break in `record.json`.
The `code` text of the break names the code fault that the break copies.
The check applies the break to a copy of the model in a temporary folder, and TLC must find the violation.
The break never changes a file in the repository.

## Bounds and assumptions

`AskLifecycle.cfg` sets `N = 3`, so three calls of one turn compete for the screen.
Each call can wait, open its Ask, fail to open it, get Answers, get Escape, or get an abort.
The model has no other bound, and TLC checks every reachable state.

The model assumes these facts about `@earendil-works/pi-coding-agent` 0.83.0 and `effect` 3.22.1:

- `ui.custom` runs the component factory before it returns, and it attaches the component in a microtask.
- `ui.custom` attaches no component after the dialog closes.
- The `done` function of `ui.custom` closes the dialog one time, and it restores the editor.
- A factory error rejects the promise of `ui.custom`, and the editor stays on the screen.
- `semaphore.withPermits(1)` holds the permit until the effect ends, also after an interruption.
- `Effect.runPromise` with a signal interrupts the fiber when the signal aborts.
- An interruption of `Effect.async` runs its canceler, and a later `resume` has no effect.
- A step that runs in one macrotask is one step.
  The Effect scheduler can yield to a timer, so the model splits steps where the fiber can yield.

When a change updates the pi or Effect version, read the code of these facts again.

## What the check does not cover

- The navigation between Questions, the Other text entry, and the multiSelect rules inside one Ask. The seam tests cover them.
- The viewport, the scroll keys, the rendering, and the sanitization of terminal text.
- The schema bounds and the text of the result. The seam tests cover them.
- The non-TUI modes, which return before the queue.
- The order in which waiting calls get the turn. The model lets any waiting call go next.
- Two pi sessions. Each session loads its own extension, so each has its own queue.

## Model map

Each action in `AskLifecycle.tla` is one indivisible step in the code at the sync commit.

| Action | Code |
| --- | --- |
| `Acquire` | `src/index.ts:98`: `semaphore.withPermits(1)` takes the permit. |
| `ShowAsk` | `src/live-ask-ui.ts:1001-1028`: `Effect.async` calls `ui.custom`, the factory sets `dismiss`, and pi attaches the component. |
| `ShowFails` | `src/live-ask-ui.ts:1030-1036`: `ui.custom` rejects, and the handler sets `settled` and resumes with `Effect.die`. |
| `UserAnswers` | `src/live-ask-ui.ts:938-951`: the last Answer calls `done(answers)`, and `complete` closes the dialog and resumes. |
| `UserCancels` | `src/live-ask-ui.ts:933-935`: Escape calls `done(null)`, and `complete` closes the dialog and resumes. |
| `TurnAborts` | Pi aborts the signal of the call. |
| `Interrupted` | `src/index.ts:111-121` and `src/live-ask-ui.ts:1038`: the fiber stops, the canceler calls `dismiss`, the permit returns, and the catch block throws the declined error. |
| `Returns` | `src/index.ts:99-121` and `src/live-ask-ui.ts:1039-1045`: the fiber ends, the permit returns, and `executeAsk` returns Answers or throws. |
| `AllReturned` | Each call of the model returned. |

## Read a result

- Read each TLC result with the `/statechart` skill.
  For a property that breaks, it gives the shortest path in plain words.
- Replay each path against the real code, one step for each action.
  `test/registered-tool.test.ts` drives `execute` with a stub AskUI Layer, and with the production Layer on a fake `ui.custom`.
- If a step of the path cannot occur in the code, the model is wrong. Correct the model, and say what was wrong.
- If each step can occur, it is a bug in the code. Report the path in the words of the code, and do not weaken the property.

## Update the verification for an intended change

1. Read the diff of each covered file, and decide if the change alters what the model describes.
2. Change `AskLifecycle.tla` and the model map from the code, before you run the check. Keep one indivisible code step as one action.
3. Change a property only when the promise changed on purpose. Cite the evidence, such as an ADR, a ticket, or a test.
4. Run `bun run verify`, and read each failure as "Read a result" tells you.
5. Copy each new SHA-256 that the check prints into `record.json`. The model files have their digests in `model.specSha256` and `model.configSha256`.
6. When the model no longer contains the find text of a break, write a new break for the same guard.
7. When a finding no longer breaks, set its status to `holds` and record a break for it.
8. Run `bun run verify` again until it passes.

## Sync commit

`syncCommit` in `record.json` is the main commit at which a person last confirmed that the model describes the covered code.
This repository squash-merges each PR, so a commit of a PR branch is not on main after the merge.
On a PR branch, keep `syncCommit` at a main commit.
The SHA-256 digests in `record.json` name the exact content that the model describes.
To find the newest main commit that the record describes, find the newest main commit where each covered file has its recorded digest.
Move `syncCommit` only after you confirm that the model describes the code at the new commit.

## State chart file of each PR

Each PR adds one state chart file to `charts/` in this skill folder.
The file name is the branch name with the extension `.md`.
A later PR from the same branch name changes that file.
A hyphen replaces each character that is not a letter, a digit, `.`, `_`, or `-`.
For example, the branch `fm/pi-ask-user-question-verification-setup` has the file `charts/fm-pi-ask-user-question-verification-setup.md`.

The check runs before the PR exists, so it reads only the committed chart file and its SVG image.
After the pipeline pushes the branch, post one PR comment that shows the SVG image at the pushed commit and links the chart file.
For example, write `![State chart](https://github.com/<owner>/<repo>/blob/<commit>/<image path>?raw=true)` and a link to the chart file at the same commit.
No check depends on that comment.
Do not add the chart to the PR text, because the pipeline writes the full PR text again on each run.

The chart shows only the states that the PR changes, and the states around them that a reader needs to follow the change.
It does not show the full application.
The chart must define each class that it applies with a `classDef` line, because a Mermaid viewer ignores a class with no definition.
Write the TLA+ model of the chart in a scratch folder outside the repository, and draw it with the `/statechart` skill.
When the PR changes the Ask lifecycle, you can start from a copy of `AskLifecycle.tla` with `N = 2`.

When the PR changes no behavior that moves between states, write "No state change" at the start of a line.
Then write one sentence that says why.

### Image of the chart

Each chart file with a Mermaid chart also has an SVG image beside it.
A person can read an SVG image at any zoom.
Render the Mermaid text to an SVG file as the render guide of the `/statechart` skill says.
Give the image the base name of the chart file and the extension `.svg`, in the same folder.
Show the image in the chart file with a relative link above the Mermaid text, such as `![State chart](fm-pi-ask-user-question-verification-setup.svg)`.

The image must name the chart digest as `Chart digest: <digest>`, for example in a `desc` element at the start of the SVG.
The chart digest is the SHA-256 of the lines between the line `` ```mermaid `` and the closing fence, with each line end.
The check compares the digest in the image with the digest of the chart text, and it does not render.
When the two differ, the image is older than the chart text, so render the image again and write the new digest.
The check prints the expected digest when it fails.
A "No state change" note needs no image.

For drift that builds up across many commits, use the `/maintain-formal-verification-skill` skill.
