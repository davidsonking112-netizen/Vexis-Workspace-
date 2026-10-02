import { DateTime, Deferred, Effect } from "effect"
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
import { EventV2 } from "../event"
import { SessionEvent } from "../session/event"

export type RunInput = {
  readonly location: Location.Ref
  readonly plan: Plan
  readonly agent?: string
  readonly parentSessionID?: string
  readonly concurrency?: number
  readonly onEvent?: (event: Cascade.Event) => Effect.Effect<void, never>
  readonly resume?: Cascade.ResumeState
  readonly resumeSessionID?: string
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

const activeRuns = new Map<string, Deferred.Deferred<void>>()

const errorData = (error: unknown) => {
  if (error instanceof Error) return { name: error.name, message: error.message }
  if (typeof error === "string") return { message: error }
  try { return JSON.parse(JSON.stringify(error)) } catch { return { message: String(error) } }
}

export const cancel = (parentSessionID: string): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const deferred = activeRuns.get(parentSessionID)
    if (!deferred) return false
    yield* Deferred.succeed(deferred, undefined)
    return true
  })

export const run = (
  input: RunInput,
): Effect.Effect<ProjectResult, unknown, Session.Service | Git.Service | Global.Service | FSUtil.Service> =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const events = yield* EventV2.Service
    const git = yield* Git.Service
    const global = yield* Global.Service
    const fs = yield* FSUtil.Service
    const memory = yield* ProjectMemory.Service
    const projectMemory = yield* memory.context(input.location.directory)
    const parentSessionID = input.parentSessionID ?? input.resumeSessionID
    const history = input.resumeSessionID
      ? yield* Effect.gen(function* () {
          const sessionID = Session.ID.make(input.resumeSessionID!)
          const events: SessionEvent.DurableEvent[] = []
          let after: number | undefined
          for (let page = 0; page < 100; page++) {
            const next = yield* sessions.history({ sessionID, after, limit: 100 }).pipe(
              Effect.catch(() => Effect.succeed({ events: [] as SessionEvent.DurableEvent[], hasMore: false })),
            )
            events.push(...next.events)
            if (!next.hasMore) break
            const last = next.events.at(-1)
            if (!last?.durable) break
            after = last.durable.seq
          }
          return events
        })
      : undefined
    const cascadeHistory = history?.filter((event): event is SessionEvent.DurableEvent =>
      event.type.startsWith("session.next.cascade."),
    )
    const started = cascadeHistory?.toReversed().find((event): event is SessionEvent.Cascade.Started =>
      event.type === "session.next.cascade.started",
    )
    const storedPlan = started?.data.tasks?.map((task) => ({
      ...task,
      run: () => Effect.succeed([] as readonly Artifact[]),
    }))
    const resumeFromHistory = cascadeHistory
      ? {
          results: new Map<string, Cascade.TaskResult>(
            cascadeHistory.flatMap((event) => {
              if (event.type === "session.next.cascade.task.completed") {
                return [[event.data.taskID, {
                  id: event.data.taskID,
                  state: "completed" as const,
                  artifacts: event.data.artifacts,
                  attempts: event.data.attempts,
                }]]
              }
              if (event.type === "session.next.cascade.task.failed") {
                return [[event.data.taskID, {
                  id: event.data.taskID,
                  state: "failed" as const,
                  artifacts: [],
                  attempts: event.data.attempts,
                  error: event.data.error,
                }]]
              }
              if (event.type === "session.next.cascade.task.cancelled") {
                return [[event.data.taskID, {
                  id: event.data.taskID,
                  state: "cancelled" as const,
                  artifacts: [],
                  attempts: 0,
                  error: event.data.reason,
                }]]
              }
              return []
            }),
          ),
          artifacts: new Map<string, unknown>(
            cascadeHistory
              .filter((event): event is SessionEvent.Cascade.TaskCompleted => event.type === "session.next.cascade.task.completed")
              .flatMap((event) => event.data.artifacts.map((artifact) => [artifact.key, artifact.value] as const)),
          ),
        } satisfies Cascade.ResumeState
      : undefined
    const baseRepo = yield* git.repo.discover(input.location.directory)
    const baseHead = baseRepo ? yield* git.history.head(baseRepo) : undefined
    const baseBranch = baseRepo ? yield* git.history.branch(baseRepo) : undefined
    const baseChanges = baseRepo
      ? yield* git.change.capture({ repository: baseRepo, path: input.location.directory }).pipe(
          Effect.catch(() => Effect.succeed(Git.ChangeSet.make(""))),
        )
      : Git.ChangeSet.make("")
    const hasBaseChanges = baseChanges.toString().length > 0
    const concurrency = hasBaseChanges ? 1 : input.concurrency

    const publish = (event: Cascade.Event) =>
      parentSessionID
        ? Effect.gen(function* () {
            const timestamp = yield* DateTime.now
            const base = { timestamp, sessionID: Session.ID.make(parentSessionID) }
            switch (event.type) {
              case "cascade.started":
                yield* events.publish(SessionEvent.Cascade.Started, {
                  ...base, taskCount: event.taskCount,
                  tasks: event.tasks?.map(({ run: _run, ...task }) => task),
                }, { location: input.location })
                break
              case "cascade.resumed":
                yield* events.publish(SessionEvent.Cascade.Resumed, { ...base, completedCount: event.completedCount }, { location: input.location })
                break
              case "cascade.task.started":
                yield* events.publish(SessionEvent.Cascade.TaskStarted, { ...base, taskID: event.taskID, attempt: event.attempt }, { location: input.location })
                break
              case "cascade.task.retrying":
                yield* events.publish(SessionEvent.Cascade.TaskRetrying, { ...base, taskID: event.taskID, attempt: event.attempt, error: errorData(event.error) }, { location: input.location })
                break
              case "cascade.task.artifact":
                yield* events.publish(SessionEvent.Cascade.TaskArtifact, { ...base, taskID: event.taskID, key: event.key, kind: event.kind }, { location: input.location })
                break
              case "cascade.task.completed":
                yield* events.publish(SessionEvent.Cascade.TaskCompleted, {
                  ...base, taskID: event.taskID, attempts: event.attempts,
                  artifacts: event.artifacts.map((artifact) => ({ ...artifact })),
                }, { location: input.location })
                break
              case "cascade.task.failed":
                yield* events.publish(SessionEvent.Cascade.TaskFailed, { ...base, taskID: event.taskID, error: errorData(event.error), attempts: event.attempts }, { location: input.location })
                break
              case "cascade.task.cancelled":
                yield* events.publish(SessionEvent.Cascade.TaskCancelled, { ...base, taskID: event.taskID, reason: event.reason }, { location: input.location })
                break
              case "cascade.cancelled":
                yield* events.publish(SessionEvent.Cascade.Cancelled, { ...base, reason: event.reason }, { location: input.location })
                break
              case "cascade.completed":
                yield* events.publish(SessionEvent.Cascade.Completed, {
                  ...base,
                  taskCount: event.results.size,
                  completedCount: [...event.results.values()].filter((result) => result.state === "completed").length,
                }, { location: input.location })
                break
            }
          })
        : Effect.void

    const runTask = (task: Task, context: ReadonlyMap<string, unknown>) =>
      Effect.acquireUseRelease(
        Effect.gen(function* () {
          const shouldIsolate = Boolean(task.mutatesWorkspace && baseRepo && !hasBaseChanges)
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
              parentID: parentSessionID ? Session.ID.make(parentSessionID) : undefined,
              agent: task.agent ?? input.agent,
              metadata: {
                cascade: {
                  taskID: task.id,
                  role: task.role,
                  dependsOn: task.dependsOn ?? [],
                  capability: task.capability,
                  retries: task.retries ?? 0,
                  parentSessionID: input.parentSessionID,
                  git: {
                    isolated: execution.isolated,
                    head: baseHead,
                    branch: baseBranch,
                    dirtyBase: hasBaseChanges,
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
      tasks: (storedPlan ?? input.plan.tasks).map((task) => ({
        ...task,
        run: (context) => runTask(task, context.artifacts),
      })),
    }

    const resume = input.resume ?? resumeFromHistory
    const deferred = parentSessionID ? yield* Deferred.make<void>() : undefined
    if (parentSessionID && deferred) activeRuns.set(parentSessionID, deferred)
    const onEvent = (event: Cascade.Event) =>
      publish(event).pipe(Effect.andThen(input.onEvent ? input.onEvent(event) : Effect.void))
    const execution = Cascade.run(plan, {
      concurrency,
      capabilities: CapabilityRegistry.capabilities(),
      onEvent,
      resume,
    })
    return yield* (deferred
      ? Effect.raceFirst(execution, Deferred.await(deferred).pipe(Effect.andThen(Effect.interrupt))).pipe(
          Effect.ensuring(Effect.sync(() => activeRuns.delete(parentSessionID!))),
        )
      : execution)
  })
