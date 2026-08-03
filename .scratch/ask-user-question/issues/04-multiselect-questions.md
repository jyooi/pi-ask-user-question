# 04 - multiSelect Questions

**What to build:** Questions whose choices are not mutually exclusive.
When a Question sets multiSelect, the component switches to toggle-style selection.
Space toggles an Option, Enter confirms the set.
Confirmation needs at least one selected Option or an Other answer.
The result line joins the chosen Labels with commas.

**Blocked by:** 02 - Single Question, single-select Ask in the TUI.

**Status:** ready-for-agent

- [ ] A multiSelect Question renders toggle markers on every Option row.
- [ ] Space toggles the highlighted Option on and off.
- [ ] Enter with zero selections and no Other answer does nothing visible except a hint.
- [ ] Enter with selections returns all chosen Labels as the Answer.
- [ ] The result line lists the Labels comma-joined, and details carry them as an array.
- [ ] Seam tests cover multiSelect Answers with one and with several Labels.
