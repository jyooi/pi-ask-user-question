import { Type, type Static } from "typebox"

const Option = Type.Object({
  label: Type.String({
    description: "The Option Label shown to the user.",
  }),
  description: Type.String({
    description: "A concise explanation of the Option and its trade-offs.",
  }),
})

const Question = Type.Object({
  header: Type.String({
    maxLength: 12,
    description: "A short Header chip with at most twelve characters.",
  }),
  question: Type.String({
    description: "The Question text shown to the user.",
  }),
  multiSelect: Type.Boolean({
    description: "Whether the user may select several Options.",
  }),
  options: Type.Array(Option, {
    minItems: 2,
    maxItems: 4,
    description: "Two to four Options for this Question.",
  }),
})

export const AskParameters = Type.Object({
  questions: Type.Array(Question, {
    minItems: 1,
    maxItems: 4,
    description: "One to four Questions in this Ask.",
  }),
})

export type Ask = Static<typeof AskParameters>

export interface AnswerDetails {
  readonly header: string
  readonly question: string
  readonly selectedLabels: readonly string[]
  readonly otherText?: string
}

export interface AskResultDetails {
  readonly answers: readonly AnswerDetails[]
}
