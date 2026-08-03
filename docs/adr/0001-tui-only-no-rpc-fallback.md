# TUI only, no RPC fallback

Pi reports `ctx.hasUI === true` in RPC mode, and per-question `ctx.ui.select` dialogs would work there.
We still guard on `ctx.mode === "tui"` and throw everywhere else, including RPC.
The full-parity component needs `ctx.ui.custom()`, which only works in a real terminal.
A degraded RPC flow would split the UI into two code paths for a client we do not use.
When the guard fails, the tool throws an error that tells the model no interactive user is available.

## Considered Options

- Tiered fallback: full component in TUI, chained select/input dialogs in RPC, error when headless. Rejected to keep one UI path.
- Auto-answer with the first option when headless. Rejected because it hides that the user never chose.
