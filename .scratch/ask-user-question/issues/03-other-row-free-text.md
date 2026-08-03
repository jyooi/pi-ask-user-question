# 03 - Other row with free-text input

**What to build:** the free-text escape hatch on every Question.
The component appends an Other row below the Options.
When the user selects it, a text entry opens inside the component.
The typed text becomes the Answer, quoted and marked with `(other)` in the result line.
The details entry carries the free text in its own field.

**Blocked by:** 02 - Single Question, single-select Ask in the TUI.

**Status:** ready-for-agent

- [ ] Every Question shows an Other row after its listed Options.
- [ ] Selecting Other opens free-text entry, and Enter submits the typed Answer.
- [ ] Escape from the text entry returns to the Option list without canceling the Ask.
- [ ] An empty Other submission is rejected, and the user stays in text entry.
- [ ] The result line quotes the free text and appends the `(other)` marker.
- [ ] Seam tests cover the Other Answer through the stub Layer.
