import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, posix } from "node:path"
import { promisify } from "node:util"

interface Break {
  readonly code: string
  readonly find: string
  readonly replace: string
}

interface Property {
  readonly name: string
  readonly status: "holds" | "finding"
  readonly break?: Break
}

export interface VerificationRecord {
  readonly tool: {
    readonly version: string
    readonly url: string
    readonly sha256: string
  }
  readonly model: {
    readonly spec: string
    readonly specSha256: string
    readonly config: string
    readonly configSha256: string
  }
  readonly covers: readonly { readonly file: string; readonly sha256: string }[]
  readonly properties: readonly Property[]
}

interface TlcRun {
  readonly code: number
  readonly output: string
}

interface Outcome {
  readonly problems: readonly string[]
  readonly notes: readonly string[]
}

const runFile = promisify(execFile)
const repositoryRoot = join(import.meta.dirname, "..")
const skillName = "verify-ask-lifecycle"
const skillPath = posix.join(".claude", "skills", skillName)
const chartDirectory = posix.join(skillPath, "charts")
const defaultBranch = "origin/main"
const passed = "Model checking completed. No error has been found."

const sha256 = (data: string | Uint8Array): string =>
  createHash("sha256").update(data).digest("hex")

const git = async (root: string, ...args: string[]): Promise<string> =>
  (
    await runFile("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 })
  ).stdout.trim()

const violated = (run: TlcRun, name: string): boolean =>
  run.output.includes(`Invariant ${name} is violated`)

const tlcError = (run: TlcRun): string => {
  const lines = run.output.split("\n")
  const start = lines.findIndex((line) => line.startsWith("Error:"))
  return lines
    .slice(start === -1 ? 0 : start)
    .slice(0, 200)
    .join("\n")
}

const verifiedFiles = (
  record: VerificationRecord,
): readonly { readonly file: string; readonly sha256: string }[] => [
  ...record.covers,
  {
    file: posix.join(skillPath, record.model.spec),
    sha256: record.model.specSha256,
  },
  {
    file: posix.join(skillPath, record.model.config),
    sha256: record.model.configSha256,
  },
]

export const chartDigest = (text: string): string | undefined => {
  const body = /^```mermaid[ \t]*\n([\s\S]*?)^```[ \t]*$/mu.exec(text)?.[1]
  return body === undefined ? undefined : sha256(body)
}

export const chartFile = (branch: string): string =>
  posix.join(chartDirectory, `${branch.replace(/[^A-Za-z0-9._-]/gu, "-")}.md`)

export async function hasSkill(root: string): Promise<boolean> {
  const skill = join(root, skillPath, "SKILL.md")
  if (!existsSync(skill) || !existsSync(join(root, skillPath, "record.json"))) {
    return false
  }
  const frontmatter = /^---\n([\s\S]*?)\n---\n/u.exec(
    await readFile(skill, "utf8"),
  )?.[1]
  return (
    frontmatter !== undefined &&
    new RegExp(`^name: ${skillName}$`, "mu").test(frontmatter) &&
    /^description: \S/mu.test(frontmatter)
  )
}

export async function checkRecord(
  root: string,
  record: VerificationRecord,
): Promise<string[]> {
  const problems: string[] = []
  for (const verified of verifiedFiles(record)) {
    const path = join(root, verified.file)
    if (!existsSync(path)) {
      problems.push(
        `Verified file ${verified.file} is missing. Follow the ${skillName} skill to update the model and record.json.`,
      )
      continue
    }
    const actual = sha256(await readFile(path))
    if (actual !== verified.sha256) {
      problems.push(
        `Verified code changed and the verification record did not: ${verified.file} has SHA-256 ${actual}, and record.json has ${verified.sha256}. Follow the ${skillName} skill to confirm the model, then record the new digest.`,
      )
    }
  }
  return problems
}

const readCommitted = async (
  root: string,
  path: string,
): Promise<string | undefined> => {
  try {
    return await git(root, "show", `HEAD:${path}`)
  } catch {
    return undefined
  }
}

export async function checkChart(
  root: string,
  branch: string | undefined,
): Promise<Outcome> {
  let base: string
  try {
    base = await git(root, "merge-base", defaultBranch, "HEAD")
  } catch {
    return {
      problems: [
        `Cannot find the merge base of HEAD and ${defaultBranch}. Fetch ${defaultBranch} with the full history.`,
      ],
      notes: [],
    }
  }
  if (base === (await git(root, "rev-parse", "HEAD"))) {
    return {
      problems: [],
      notes: [
        `State chart file: not checked, because HEAD has no change from ${defaultBranch}.`,
      ],
    }
  }
  const changes = (
    await git(root, "diff", "--name-status", "--no-renames", base, "HEAD")
  )
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => line.split("\t"))
  const charts = changes
    .filter(
      ([status, path = ""]) =>
        status !== "D" &&
        posix.dirname(path) === chartDirectory &&
        path.endsWith(".md"),
    )
    .map(([, path = ""]) => path)
  const expected = branch === undefined ? undefined : chartFile(branch)
  if (expected !== undefined && !charts.includes(expected)) {
    return {
      problems: [
        `The change adds or changes no state chart file ${expected} for the branch ${branch}. Follow the ${skillName} skill to add one.`,
      ],
      notes: [],
    }
  }
  if (charts.length === 0) {
    return {
      problems: [
        `The change adds or changes no state chart file in ${chartDirectory}. Follow the ${skillName} skill to add one.`,
      ],
      notes: [],
    }
  }
  const problems: string[] = []
  for (const chart of charts) {
    const text = (await readCommitted(root, chart)) ?? ""
    const drawn = chartDigest(text)
    if (drawn === undefined && !/^No state change\b/mu.test(text)) {
      problems.push(
        `${chart} has no mermaid chart and no "No state change" note.`,
      )
    }
    if (drawn !== undefined) {
      const image = chart.replace(/\.md$/u, ".svg")
      const svg = await readCommitted(root, image)
      const named = svg && /Chart digest: ([0-9a-f]{64})/u.exec(svg)?.[1]
      if (svg === undefined) {
        problems.push(
          `${chart} has a chart, and no SVG image ${image} is beside it. Render the chart to that file as the ${skillName} skill says.`,
        )
      } else if (named !== drawn) {
        problems.push(
          `${image} is older than the chart text of ${chart}: the image names chart digest ${named || "none"}, and the chart text has ${drawn}. Render the image again from the chart text, and write the new digest in it.`,
        )
      }
    }
  }
  return {
    problems,
    notes: problems.length === 0 ? [`State chart file: ${charts.join(", ")}.`] : [],
  }
}

async function tlaTools(tool: VerificationRecord["tool"]): Promise<string> {
  const path = join(
    repositoryRoot,
    "node_modules",
    ".cache",
    "tla2tools",
    tool.version,
    "tla2tools.jar",
  )
  if (!existsSync(path)) {
    const response = await fetch(tool.url)
    if (!response.ok) {
      throw new Error(`Cannot download ${tool.url}: HTTP ${response.status}`)
    }
    const jar = new Uint8Array(await response.arrayBuffer())
    if (sha256(jar) !== tool.sha256) {
      throw new Error(
        `${tool.url} has SHA-256 ${sha256(jar)}, not the pinned ${tool.sha256}`,
      )
    }
    await mkdir(dirname(path), { recursive: true })
    await writeFile(`${path}.download`, jar)
    await rename(`${path}.download`, path)
  }
  const actual = sha256(await readFile(path))
  if (actual !== tool.sha256) {
    throw new Error(
      `${path} has SHA-256 ${actual}, not the pinned ${tool.sha256}`,
    )
  }
  return path
}

async function tlc(
  jar: string,
  specName: string,
  spec: string,
  config: string,
  checkDeadlock: boolean,
): Promise<TlcRun> {
  const directory = await mkdtemp(join(tmpdir(), `${skillName}-`))
  try {
    await writeFile(join(directory, specName), spec)
    await writeFile(join(directory, "Check.cfg"), config)
    const args = [
      "-XX:+UseParallelGC",
      `-Djava.io.tmpdir=${directory}`,
      "-cp",
      jar,
      "tlc2.TLC",
      "-workers",
      "1",
      "-fp",
      "0",
      ...(checkDeadlock ? [] : ["-deadlock"]),
      "-metadir",
      join(directory, "states"),
      "-config",
      "Check.cfg",
      specName,
    ]
    try {
      const { stdout, stderr } = await runFile("java", args, {
        cwd: directory,
        maxBuffer: 64 * 1024 * 1024,
      })
      return { code: 0, output: `${stdout}${stderr}` }
    } catch (error) {
      const failure = error as {
        code?: unknown
        stdout?: string
        stderr?: string
      }
      if (typeof failure.code !== "number") {
        throw error
      }
      return {
        code: failure.code,
        output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function checkModel(record: VerificationRecord): Promise<Outcome> {
  const directory = join(repositoryRoot, skillPath)
  const spec = await readFile(join(directory, record.model.spec), "utf8")
  const config = await readFile(join(directory, record.model.config), "utf8")
  const [base = "", invariantBlock = ""] = config.split(/^INVARIANTS\n/mu)
  const configured = invariantBlock.split(/\s+/u).filter((name) => name !== "")
  const recorded = [
    "TypeOK",
    ...record.properties.map((property) => property.name),
  ]
  const listProblems =
    configured.join(" ") === recorded.join(" ")
      ? []
      : [
          `${record.model.config} lists the invariants ${configured.join(", ")}, and record.json lists ${recorded.join(", ")}. Make the two lists the same.`,
        ]
  const withInvariants = (names: readonly string[]): string =>
    `${base}INVARIANTS\n${names.map((name) => `  ${name}\n`).join("")}`

  const jar = await tlaTools(record.tool)
  const holding = record.properties.filter(
    (property) => property.status === "holds",
  )
  const findings = record.properties.filter(
    (property) => property.status === "finding",
  )

  const holdsRun = tlc(
    jar,
    record.model.spec,
    spec,
    withInvariants(["TypeOK", ...holding.map((property) => property.name)]),
    true,
  ).then((run): Outcome => {
    if (run.code !== 0 || !run.output.includes(passed)) {
      return {
        problems: [`The verification check fails:\n${tlcError(run)}`],
        notes: [],
      }
    }
    const states = /([\d,]+) distinct states found/u.exec(run.output)?.[1]
    return {
      problems: [],
      notes: [
        `Properties that hold: ${holding.map((property) => property.name).join(", ")}.`,
        `TLC ${record.tool.version} checked ${states ?? "?"} distinct states.`,
      ],
    }
  })

  const findingRuns = findings.map((property) =>
    tlc(
      jar,
      record.model.spec,
      spec,
      withInvariants([property.name]),
      false,
    ).then((run): Outcome => {
      if (violated(run, property.name)) {
        return {
          problems: [],
          notes: [`Recorded finding ${property.name} still breaks.`],
        }
      }
      return {
        problems: [
          run.code === 0
            ? `The recorded finding ${property.name} no longer breaks. Confirm the fix, set its status to holds, and record a break for it.`
            : `The verification check fails on ${property.name}:\n${tlcError(run)}`,
        ],
        notes: [],
      }
    }),
  )

  const breakRuns = holding.map(async (property): Promise<Outcome> => {
    const recordedBreak = property.break
    if (recordedBreak === undefined) {
      return {
        problems: [
          `Property ${property.name} has no recorded break in record.json.`,
        ],
        notes: [],
      }
    }
    if (spec.split(recordedBreak.find).length !== 2) {
      return {
        problems: [
          `The recorded break of ${property.name} does not match the model exactly one time. Update the break in record.json.`,
        ],
        notes: [],
      }
    }
    const run = await tlc(
      jar,
      record.model.spec,
      spec.replace(recordedBreak.find, () => recordedBreak.replace),
      withInvariants([property.name]),
      false,
    )
    return violated(run, property.name)
      ? { problems: [], notes: [`Recorded break of ${property.name} is caught.`] }
      : {
          problems: [
            `The verification does not catch the recorded break of ${property.name}. The property cannot fail, so correct the model or the property.`,
          ],
          notes: [],
        }
  })

  const outcomes = await Promise.all([holdsRun, ...findingRuns, ...breakRuns])
  return {
    problems: [
      ...listProblems,
      ...outcomes.flatMap((outcome) => outcome.problems),
    ],
    notes: outcomes.flatMap((outcome) => outcome.notes),
  }
}

async function currentBranch(): Promise<string | undefined> {
  const pullRequestBranch = process.env.GITHUB_HEAD_REF
  if (pullRequestBranch) {
    return pullRequestBranch
  }
  try {
    return await git(repositoryRoot, "symbolic-ref", "--quiet", "--short", "HEAD")
  } catch {
    return undefined
  }
}

async function check(): Promise<Outcome> {
  if (!(await hasSkill(repositoryRoot))) {
    return {
      problems: [
        `The repository has no verification skill. Expected ${posix.join(skillPath, "SKILL.md")} with name and description frontmatter, and record.json beside it.`,
      ],
      notes: [],
    }
  }
  const record = JSON.parse(
    await readFile(join(repositoryRoot, skillPath, "record.json"), "utf8"),
  ) as VerificationRecord
  const outcomes = await Promise.all([
    checkRecord(repositoryRoot, record).then(
      (problems): Outcome => ({ problems, notes: [] }),
    ),
    checkModel(record),
    currentBranch().then((branch) => checkChart(repositoryRoot, branch)),
  ])
  return {
    problems: outcomes.flatMap((outcome) => outcome.problems),
    notes: outcomes.flatMap((outcome) => outcome.notes),
  }
}

if (import.meta.main) {
  const started = performance.now()
  const { problems, notes } = await check()
  const seconds = ((performance.now() - started) / 1000).toFixed(1)
  for (const note of notes) {
    console.log(note)
  }
  if (problems.length > 0) {
    console.error(
      `Verification failed in ${seconds} s:\n\n${problems.join("\n\n")}`,
    )
    process.exit(1)
  }
  console.log(`Verification passed in ${seconds} s.`)
}
