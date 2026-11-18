import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  checkChart,
  checkRecord,
  hasSkill,
  type VerificationRecord,
} from "../scripts/check-verification.js"

const skill = ".claude/skills/verify-ask-lifecycle"
const chart = `${skill}/charts/feature-x.md`
const image = `${skill}/charts/feature-x.svg`
const coveredFile = "src/index.ts"
const sha256 = (text: string): string =>
  createHash("sha256").update(text).digest("hex")

const mermaidBody = "stateDiagram-v2\n  [*] --> a\n"
const mermaid = `## State chart\n\n![State chart](feature-x.svg)\n\n\`\`\`mermaid\n${mermaidBody}\`\`\`\n`
const svg = (digest: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg"><desc>Chart digest: ${digest}</desc></svg>\n`

const record: VerificationRecord = {
  tool: { version: "1.7.4", url: "", sha256: "" },
  model: {
    spec: "AskLifecycle.tla",
    specSha256: sha256("spec\n"),
    config: "AskLifecycle.cfg",
    configSha256: sha256("config\n"),
  },
  covers: [{ file: coveredFile, sha256: sha256("one\n") }],
  properties: [],
}

let root: string

const git = (...args: string[]): string =>
  execFileSync(
    "git",
    [
      "-c",
      "user.name=test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd: root, encoding: "utf8" },
  )

const write = (files: Record<string, string>): void => {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
}

const commit = (files: Record<string, string>): void => {
  write(files)
  git("add", "-A")
  git("commit", "-q", "-m", "change")
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "check-verification-"))
  git("init", "-q", "-b", "main")
  commit({
    [coveredFile]: "one\n",
    "README.md": "one\n",
    [`${skill}/SKILL.md`]:
      "---\nname: verify-ask-lifecycle\ndescription: Check the Ask lifecycle.\n---\n",
    [`${skill}/record.json`]: "{}\n",
    [`${skill}/AskLifecycle.tla`]: "spec\n",
    [`${skill}/AskLifecycle.cfg`]: "config\n",
  })
  git("update-ref", "refs/remotes/origin/main", "HEAD")
  git("checkout", "-q", "-b", "feature/x")
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe("verification skill", () => {
  it("is found when SKILL.md has its frontmatter and record.json is beside it", async () => {
    expect(await hasSkill(root)).toBe(true)
  })

  it("is missing without record.json", async () => {
    rmSync(join(root, skill, "record.json"))
    expect(await hasSkill(root)).toBe(false)
  })

  it("is missing when SKILL.md has no name in its frontmatter", async () => {
    write({ [`${skill}/SKILL.md`]: "# Verify\n" })
    expect(await hasSkill(root)).toBe(false)
  })
})

describe("verification record", () => {
  it("passes when each verified file has its recorded digest", async () => {
    expect(await checkRecord(root, record)).toEqual([])
  })

  it("fails when verified code changed and the record did not", async () => {
    write({ [coveredFile]: "two\n" })
    expect(await checkRecord(root, record)).toEqual([
      expect.stringContaining(`${coveredFile} has SHA-256 ${sha256("two\n")}`),
    ])
  })

  it("fails when the model changed and the record did not", async () => {
    write({ [`${skill}/AskLifecycle.tla`]: "spec two\n" })
    expect(await checkRecord(root, record)).toEqual([
      expect.stringContaining(`${skill}/AskLifecycle.tla has SHA-256`),
    ])
  })
})

describe("state chart file of a change", () => {
  it("is not checked when HEAD has no change from origin/main", async () => {
    git("checkout", "-q", "main")
    expect((await checkChart(root, "main")).problems).toEqual([])
  })

  it("fails when the change adds no chart file", async () => {
    commit({ "README.md": "two\n" })
    expect((await checkChart(root, undefined)).problems).toEqual([
      expect.stringContaining("adds or changes no state chart file"),
    ])
  })

  it("fails when the chart file does not have the name of the branch", async () => {
    commit({
      [`${skill}/charts/other.md`]: "No state change: only docs change.\n",
    })
    expect((await checkChart(root, "feature/x")).problems).toEqual([
      expect.stringContaining(`adds or changes no state chart file ${chart}`),
    ])
  })

  it("passes with a no state change note named by the branch", async () => {
    commit({ [chart]: "No state change: only docs change.\n" })
    expect((await checkChart(root, "feature/x")).problems).toEqual([])
  })

  it("passes when a later PR from the same branch changes its chart file", async () => {
    git("checkout", "-q", "main")
    commit({ [chart]: "No state change: only docs change.\n" })
    git("update-ref", "refs/remotes/origin/main", "HEAD")
    git("checkout", "-q", "feature/x")
    git("reset", "-q", "--hard", "main")
    commit({ [chart]: "No state change: only the README changes.\n" })
    expect((await checkChart(root, "feature/x")).problems).toEqual([])
  })

  it("fails when the change deletes the chart file of the branch", async () => {
    git("checkout", "-q", "main")
    commit({ [chart]: "No state change: only docs change.\n" })
    git("update-ref", "refs/remotes/origin/main", "HEAD")
    git("checkout", "-q", "feature/x")
    git("reset", "-q", "--hard", "main")
    git("rm", "-q", chart)
    git("commit", "-q", "-m", "change")
    expect((await checkChart(root, "feature/x")).problems).toEqual([
      expect.stringContaining(`adds or changes no state chart file ${chart}`),
    ])
  })

  it("fails when the chart file has no mermaid chart and no note", async () => {
    commit({ [chart]: "## State chart\n\nTo do.\n" })
    expect((await checkChart(root, "feature/x")).problems).toEqual([
      expect.stringContaining("no mermaid chart"),
    ])
  })

  it("fails when a chart has no SVG image beside it", async () => {
    commit({ [chart]: mermaid })
    expect((await checkChart(root, "feature/x")).problems).toEqual([
      expect.stringContaining("no SVG image"),
    ])
  })

  it("fails when the SVG image names the digest of an older chart text", async () => {
    commit({ [chart]: mermaid, [image]: svg(sha256("stateDiagram-v2\n")) })
    expect((await checkChart(root, "feature/x")).problems).toEqual([
      expect.stringContaining("older than the chart text"),
    ])
  })

  it("passes when the SVG image names the digest of the chart text", async () => {
    commit({ [chart]: mermaid, [image]: svg(sha256(mermaidBody)) })
    expect((await checkChart(root, "feature/x")).problems).toEqual([])
  })
})
