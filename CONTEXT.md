# pi-ask-user-question

A pi extension that gives the agent a tool to ask the user structured questions.
The tool mirrors the schema and behavior of Claude Code's AskUserQuestion tool.

## Language

**Ask**:
One tool call from the model that contains one to four Questions.
_Avoid_: prompt, survey, form

**Question**:
One item inside an Ask. It has a Header, question text, two to four Options, and a multiSelect flag.

**Header**:
A chip of at most twelve characters that labels a Question in the UI, for example "Auth method".
_Avoid_: title, tag

**Option**:
One selectable choice inside a Question. It has a Label and a Description.

**Other**:
The free-text escape hatch that the UI appends to every Question. The user types a custom answer instead of picking an Option.
_Avoid_: custom option, write-in

**Answer**:
The resolved choice for one Question. It is one Label, several Labels when multiSelect is on, or free text from Other.

**AskUI**:
The Effect service that presents an Ask and returns Answers. The production Layer renders pi-tui components. Tests provide a stub Layer.
