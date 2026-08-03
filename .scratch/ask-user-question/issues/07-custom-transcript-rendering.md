# 07 - Custom transcript rendering

**What to build:** readable Ask history in the session transcript.
The tool defines custom call and result renderers.
A pending call shows the Header chips and question texts instead of raw JSON arguments.
A finished call shows each Header with its Answer, and Other Answers keep their quoted form.
Collapsed and expanded transcript views both stay readable and match pi's theme colors.

**Blocked by:** 02 - Single Question, single-select Ask in the TUI.

**Status:** ready-for-agent

- [ ] The transcript never shows raw JSON for `ask_user_question` calls or results.
- [ ] A pending call renders Header chips and question texts.
- [ ] A finished call renders one header-and-answer line per Question.
- [ ] Error results render the declined or no-user message clearly.
- [ ] Rendering uses theme colors and looks correct in expanded and collapsed tool views.
