# Effect core with an AskUI service layer

The tool's flow is an Effect program with typed errors such as `UserCancelled` and `NoInteractiveUI`.
All terminal interaction sits behind an `AskUI` service tag.
Production provides a Layer that renders pi-tui components through `ctx.ui.custom()`.
Tests provide a stub Layer, so Vitest runs the whole flow headless.
`execute()` stays a thin shell: it builds the program, provides the live Layer, and runs `Effect.runPromise`.
Pi's `AbortSignal` maps to Effect interruption.

Pi's `pi.registerTool()` validates `parameters` with TypeBox, so the tool schema stays TypeBox.
Effect Schema does not replace it at that boundary.

## Considered Options

- Effect for core logic only, with plain awaited UI calls. Rejected because the dialog flow is the heart of the tool and would sit outside Effect.
- Effect everywhere, including the pi-tui component lifecycle. Rejected because pi-tui components are imperative classes and wrapping them fights the host API.
