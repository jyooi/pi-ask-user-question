## State chart

This PR adds the verification of the Ask lifecycle, so the chart shows that lifecycle and nothing more.
TLC drew it from a scratch copy of `AskLifecycle.tla` with two Asks in one turn (341 states).
No rule breaks in this chart.

![State chart of two Asks in one turn](fm-pi-ask-user-question-verification-setup.svg)

```mermaid
---
title: "Two Asks of one turn: queue, screen, abort, and return"
---
stateDiagram-v2
  direction LR
  state "At the same time" as all {
    state "First Ask" as r0 {
      s0: Waiting for its turn
      s1: Opening
      s2: Closing
      s3: Decline returned
      s4: On screen
      s5: Error returned
      s6: Answers returned
      [*] --> s0
      s0 --> s1: it gets the turn [unless Closing or On screen or Opening]
      s1 --> s2: the Ask fails to open
      s1 --> s4: the Ask opens
      s0 --> s3: the turn is aborted
      s1 --> s3: the turn is aborted
      s2 --> s5: the call returns an error
      s4 --> s2: you answer each Question or you press Escape
      s2 --> s6: the call returns the Answers
      s2 --> s3: the call returns the decline or the turn is aborted
      s4 --> s3: the turn is aborted
    }
    --
    state "Second Ask" as r1 {
      s7: Waiting for its turn
      s8: Opening
      s9: Closing
      s10: Decline returned
      s11: On screen
      s12: Error returned
      s13: Answers returned
      [*] --> s7
      s7 --> s8: it gets the turn [unless Closing or On screen or Opening]
      s8 --> s9: the Ask fails to open
      s8 --> s11: the Ask opens
      s7 --> s10: the turn is aborted
      s8 --> s10: the turn is aborted
      s9 --> s12: the call returns an error
      s11 --> s9: you answer each Question or you press Escape
      s9 --> s13: the call returns the Answers
      s9 --> s10: the call returns the decline or the turn is aborted
      s11 --> s10: the turn is aborted
    }
  }
```

How to read the chart:

- Each region is one `ask_user_question` call of the same turn.
- "it gets the turn [unless Closing or On screen or Opening]" is the queue.
  An Ask opens only when the other Ask does not hold the turn.
- "the turn is aborted" leads to "Decline returned" from each state before the return.
  The abort also closes an Ask that is on screen.
- "the Ask fails to open" leads to "Closing", and the call returns an error.
  The call does not wait for an Answer that the user cannot give.

The chart does not draw steps that stay in one chart state, such as the abort signal before the call reacts to it.
