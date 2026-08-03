import { Context, Data, type Effect, type Layer } from "effect"

import type { Ask } from "./schema.js"

export interface Answer {
  readonly selectedLabels: readonly string[]
  readonly otherText?: string
}

export class UserCancelled extends Data.TaggedError("UserCancelled")<{}> {}

export class NoInteractiveUI extends Data.TaggedError("NoInteractiveUI")<{}> {}

export interface AskUIService {
  readonly ask: (
    ask: Ask,
  ) => Effect.Effect<readonly Answer[], UserCancelled | NoInteractiveUI>
}

export class AskUI extends Context.Tag("pi-ask-user-question/AskUI")<
  AskUI,
  AskUIService
>() {}

export type AskUILayer = Layer.Layer<AskUI>
