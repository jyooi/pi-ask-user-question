# 06 - Abort dismissal and Ask serialization

**What to build:** correct behavior when the turn dies or when Asks collide.
When the user aborts the agent turn, the open component closes and the editor returns to normal.
The aborted call resolves as a declined Ask, and Effect interruption carries the signal.
Pi runs tool calls in parallel, so two simultaneous `ask_user_question` calls must not fight for the screen.
A per-session queue shows one Ask at a time and starts the next after the first resolves.

**Blocked by:** 02 - Single Question, single-select Ask in the TUI.

**Status:** ready-for-agent

- [ ] Aborting the turn while an Ask is open dismisses the component without visual artifacts.
- [ ] The aborted tool call resolves as declined, and the session stays usable.
- [ ] Two tool calls in one batch produce two sequential Asks, never two overlapping components.
- [ ] Both queued Asks return their own correct Answers when the user completes them.
- [ ] Seam tests cover interruption and the two-Ask serialization order.
