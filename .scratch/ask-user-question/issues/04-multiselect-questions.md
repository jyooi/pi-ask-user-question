# 04 - multiSelect Questions

**What to build:** Questions whose choices are not mutually exclusive.
When a Question sets multiSelect, the component switches to toggle-style selection.
Space toggles an Option, Enter confirms the set.
Confirmation needs at least one selected Option or an Other Answer.
Other adds free text alongside toggled Labels in a multiSelect Answer.
Other remains exclusive for a single-select Question.
The result line joins chosen Labels with commas, then appends quoted Other text.

**Blocked by:** 02 - Single Question, single-select Ask in the TUI.

**Status:** ready-for-agent

- [ ] A multiSelect Question renders toggle markers on every Option row.
- [ ] Space toggles the highlighted Option on and off.
- [ ] Enter with zero selections and no Other answer does nothing visible except a hint.
- [ ] Enter with selections returns all chosen Labels as the Answer.
- [ ] Other preserves toggled Labels and adds free text to a multiSelect Answer.
- [ ] The result line lists every Answer part, and details preserve Labels and Other text.
- [ ] Seam tests cover multiSelect Answers with one and with several Labels.
