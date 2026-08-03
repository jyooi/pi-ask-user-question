# 02 - Single Question, single-select Ask in the TUI

**What to build:** the first real user-facing Ask.
The production AskUI Layer renders a pi-tui component through the custom UI hook.
One Question shows its Header chip, question text, and Options with descriptions.
Arrow keys move the highlight, Enter confirms, Escape cancels the whole Ask.
On confirm the model receives the header-and-answer line and the structured details.
On cancel the model receives the declined error and does not repeat the Ask.

**Blocked by:** 01 - Package scaffold and registered-tool seam.

**Status:** ready-for-agent

- [ ] A live pi session shows the component when the model calls the tool with one Question.
- [ ] The component renders the Header chip, question text, and every Option with its description.
- [ ] Enter returns the highlighted Option as the Answer.
- [ ] Escape raises the cancel error, and the editor returns to normal.
- [ ] The production Layer maps user actions to the same AskUI contract the stub Layer implements.
- [ ] Seam tests stay green, and new tests cover the single-select Answer format.
