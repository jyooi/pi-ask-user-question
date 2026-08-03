# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Use the domain vocabulary from `CONTEXT.md` in code, tests, and documentation.
- Treat `.scratch/ask-user-question/spec.md` and its ticket files as authoritative scope.
- Run `bun run test`, `bun run lint`, and `bun run typecheck` before each commit.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows.
Point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
