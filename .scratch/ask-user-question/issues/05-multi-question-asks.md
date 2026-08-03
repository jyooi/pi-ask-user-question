# 05 - Multi-Question Asks

**What to build:** one Ask that carries up to four Questions.
The component shows the Header chips of all Questions, with the active one highlighted.
The user answers Questions in order, and each Answer advances to the next Question.
After the last Answer, the tool returns one line per Question.
Escape from an Option list on any Question cancels the whole Ask, and no partial Answers reach the model.
Other text-entry Escape behavior remains owned by ticket 03.

**Blocked by:** 02 - Single Question, single-select Ask in the TUI.

**Status:** ready-for-agent

- [ ] An Ask with four Questions shows all four Header chips with clear active-state styling.
- [ ] Answering a Question advances to the next unanswered Question.
- [ ] The user can move back to an answered Question and change its Answer before final confirmation.
- [ ] The result contains one header-and-answer line per Question, in Ask order.
- [ ] Escape from the Option list on any Question cancels the whole Ask with the declined error.
- [ ] Seam tests cover multi-Question Answers and whole-Ask cancellation.
