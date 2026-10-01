import { Effect } from "effect"
import path from "path"
import { PromptInput } from "@vexis/schema/prompt-input"
import * as Session from "../session"
import { Location } from "../location"
import { Global } from "../global"
import { FSUtil } from "../fs-util"
import { Git } from "../git"
import { Cascade, type Plan, type Task, type ProjectResult, type Artifact } from "../cascade"
import * as CapabilityRegistry from "./capability"
import { AbsolutePath } from "../schema"
import { ProjectMemory } from "../project/memory"

export type RunInput = {
  readonly location: Location.Ref
  readonly plan: Plan
  readonly agent?: string
  readonly parentSessionID?: string
  readonly concurrency?: number
  readonly onEvent?: (event: Cascade.Event) => Effect.Effect<void, never>
}

const taskPrompt = (task: Task, context: ReadonlyMap<string, unknown>, memory: string) => {
  const dependencyContext = [...context.entries()]
    .map(([key, value]) => `\nArtifact ${key}:\n${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join("")

  return PromptInput.Prompt.make({
    text: [
      `You are a Vexis Cascade worker. Execute task: ${task.title ?? task.id}`,
      task.prompt ?? "",
      `Task ID: ${task.id}`,
      task.role ? `Specialist role: ${task.role}` : "",
      memory ? `Project memory:\n${memory}` : "",
      dependencyContext,
      "",
      "Work from the supplied artifacts first. Do not repeat upstream work unless needed to validate it.",
      "Complete the task directly in the workspace when appropriate. Return a concise result describing what you accomplished, important findings, and any files or decisions that downstream tasks should know about.",
    ].join("\n"),
  })
}

const resultArtifact = (
  task: Task,
  input: {
    sessionID: string
    output: string
    workspace: string
    isolated: boolean
    changeSet?: string
    baseHead?: string
    baseBranch?: string
  },
): Artifact => ({
  key: `cascade:${task.id}`,
  value: {
    sessionID: input.sessionID,
    taskID: task.id,
    role: task.role,
    output: input.output,
    status: "completed",
    workspace: input.workspace,
    isolated: input.isolated,
    changeSet: input.changeSet,
    baseHead: input.baseHead,
    baseBranch: input.baseBranch,
  },
  taskID: task.id,
  kind: input.changeSet ? "change" : "result",
  label: task.title ?? task.id,
  metadata: {
    sessionID: input.sessionID,
    role: task.role,
    isolated: input.isolated,
    workspace: input.workspace,
  },
})

export const run = (
  input: RunInput,
): Effect.Effect<ProjectResult, unknown, Session.Service | Git.Service | Global.Service | FSUtil.Service> =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const git = yield* Git.Service
    const global = yield* Global.Service
    const fs = yield* FSUtil.Service
    const memory = yield* ProjectMemory.Service
    const projectMemory = yield* memory.context(input.location.directory)
    const baseRepo = yield* git.repo.discover(input.location.directory)
    const baseHead = baseRepo ? yield* git.history.head(baseRepo) : undefined
    const baseBranch = baseRepo ? yield* git.history.branch(baseRepo) : undefined
    const baseChanges = baseRepo
      ? yield* git.change.capture({ repository: baseRepo, path: input.location.directory }).pipe(
          Effect.catch(() => Effect.succeed(Git.ChangeSet.make(""))),
        )
      : Git.ChangeSet.make("")
    const concurrency = baseChanges ? 1 : input.concurrency

    const runTask = (task: Task, context: ReadonlyMap<string, unknown>) =>
      Effect.acquireUseRelease(
        Effect.gen(function* () {
          const shouldIsolate = Boolean(task.mutatesWorkspace && baseRepo && !baseChanges)
          if (!shouldIsolate) return { workspace: input.location.directory, repository: baseRepo, isolated: false }

          const workspace = path.join(
            global.tmp,
            "cascade",
            input.parentSessionID ?? "root",
            task.id.replace(/[^a-zA-Z0-9._-]/g, "-"),
          )
          yield* fs.ensureDir(path.dirname(workspace))
          const repository = yield* git.worktree.create({
            repository: baseRepo!,
            directory: AbsolutePath.make(workspace),
          })
          return { workspace, repository, isolated: true }
        }),
        (execution) =>
          Effect.gen(function* () {
            const created = yield* sessions.create({
              location: Location.Ref.make({
                directory: execution.workspace,
                workspaceID: input.location.workspaceID,
              }),
              parentID: input.parentSessionID ? Session.ID.make(input.parentSessionID) : undefined,
              agent: task.agent ?? input.agent,
              metadata: {
                cascade: {
                  taskID: task.id,
                  role: task.role,
                  dependsOn: task.dependsOn ?? [],
                  parentSessionID: input.parentSessionID,
                  git: {
                    isolated: execution.isolated,
                    head: baseHead,
                    branch: baseBranch,
                    dirtyBase: Boolean(baseChanges),
                  },
                },
              },
            })
            yield* sessions.prompt({ sessionID: created.id, prompt: taskPrompt(task, context, projectMemory) })
            yield* sessions.wait(created.id)
            const messages = yield* sessions.messages({ sessionID: created.id, limit: 20, order: "desc" })
            const output = messages
              .flatMap((message) => "parts" in message ? message.parts : [])
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("\n")
              .trim()

            let changeSet: Git.ChangeSet | undefined
            if (execution.repository && task.mutatesWorkspace) {
              const captured = yield* git.change.capture({ repository: execution.repository, path: execution.workspace })
              if (captured && baseRepo && execution.isolated) {
                yield* git.change.apply({
                  repository: baseRepo,
                  path: input.location.directory,
                  changes: captured,
                })
              }
              changeSet = captured || undefined
            }

            return [resultArtifact(task, {
              sessionID: created.id,
              output,
              workspace: execution.workspace,
              isolated: execution.isolated,
              changeSet,
              baseHead,
              baseBranch,
            })]
          }),
        (execution) =>
          execution.isolated && baseRepo
            ? git.worktree.remove({ repository: baseRepo, directory: execution.workspace, force: true }).pipe(Effect.ignore)
            : Effect.void,
      )

    const plan: Plan = {
      ...input.plan,
      tasks: input.plan.tasks.map((task) => ({
        ...task,
        run: (context) => runTask(task, context.artifacts),
      })),
    }

    return yield* Cascade.run(plan, {
      concurrency,
      capabilities: CapabilityRegistry.capabilities(),
      onEvent: input.onEvent,
    })
  })
