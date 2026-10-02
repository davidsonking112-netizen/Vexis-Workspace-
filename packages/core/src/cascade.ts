export * as Cascade from "./cascade"
export * as CascadeSession from "./cascade/session"

import { Effect } from "effect"

export type TaskID = string
export type Capability = { readonly id: string; readonly description?: string; readonly activate?: Effect.Effect<void, unknown> }
export type Artifact = {
  readonly key: string
  readonly value: unknown
  readonly taskID: TaskID
  readonly kind?: "result" | "change" | "snapshot" | "test" | "review" | "report"
  readonly label?: string
  readonly metadata?: Readonly<Record<string, unknown>>
}
export type TaskContext = {
  readonly taskID: TaskID
  readonly artifacts: ReadonlyMap<string, unknown>
  readonly capability: Capability | undefined
  readonly attempt: number
}
export type Task = {
  readonly id: TaskID
  readonly title?: string
  readonly prompt?: string
  readonly capability?: string
  readonly role?: string
  readonly agent?: string
  readonly mutatesWorkspace?: boolean
  readonly dependsOn?: readonly TaskID[]
  readonly retries?: number
  readonly run: (context: TaskContext) => Effect.Effect<readonly Artifact[], unknown>
}
export type TaskState = "pending" | "running" | "completed" | "failed" | "cancelled"
export type TaskResult = {
  readonly id: TaskID
  readonly state: TaskState
  readonly error?: unknown
  readonly artifacts: readonly Artifact[]
  readonly attempts?: number
}
export type ProjectResult = {
  readonly results: ReadonlyMap<TaskID, TaskResult>
  readonly artifacts: ReadonlyMap<string, unknown>
}
export type ResumeState = ProjectResult
export type Plan = { readonly tasks: readonly Task[]; readonly capabilities?: readonly Capability[] }
export type Event =
  | { readonly type: "cascade.started"; readonly taskCount: number; readonly tasks?: readonly Omit<Task, "run">[] }
  | { readonly type: "cascade.resumed"; readonly completedCount: number }
  | { readonly type: "cascade.task.started"; readonly taskID: TaskID; readonly attempt: number }
  | { readonly type: "cascade.task.retrying"; readonly taskID: TaskID; readonly attempt: number; readonly error: unknown }
  | { readonly type: "cascade.task.artifact"; readonly taskID: TaskID; readonly key: string; readonly kind?: Artifact["kind"] }
  | { readonly type: "cascade.task.completed"; readonly taskID: TaskID; readonly artifactCount: number; readonly attempts: number; readonly artifacts: readonly Artifact[] }
  | { readonly type: "cascade.task.failed"; readonly taskID: TaskID; readonly error: unknown; readonly attempts: number }
  | { readonly type: "cascade.task.cancelled"; readonly taskID: TaskID; readonly reason: string }
  | { readonly type: "cascade.cancelled"; readonly reason: string }
  | { readonly type: "cascade.completed"; readonly results: ReadonlyMap<TaskID, TaskResult> }
export type Options = {
  readonly concurrency?: number
  readonly capabilities?: readonly Capability[]
  readonly onEvent?: (event: Event) => Effect.Effect<void, never>
  readonly resume?: ResumeState
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

export const run = (plan: Plan, options: Options = {}): Effect.Effect<ProjectResult, Error> =>
  Effect.gen(function* () {
    const concurrency = Math.max(1, options.concurrency ?? 4)
    const capabilityList = [...(options.capabilities ?? []), ...(plan.capabilities ?? [])]
    const capabilities = new Map(capabilityList.map((capability) => [capability.id, capability]))
    const tasks = new Map<TaskID, Task>()
    for (const task of plan.tasks) {
      if (tasks.has(task.id)) return yield* Effect.fail(new Error(`Duplicate Cascade task: ${task.id}`))
      tasks.set(task.id, task)
    }
    for (const task of plan.tasks) {
      for (const dependency of task.dependsOn ?? []) {
        if (!tasks.has(dependency)) return yield* Effect.fail(new Error(`Cascade task ${task.id} depends on missing task ${dependency}`))
      }
      if (task.capability && !capabilities.has(task.capability))
        return yield* Effect.fail(new Error(`Cascade task ${task.id} requires unavailable capability ${task.capability}`))
    }

    const hasCycle = () => {
      const visiting = new Set<TaskID>()
      const visited = new Set<TaskID>()
      const visit = (id: TaskID): boolean => {
        if (visiting.has(id)) return true
        if (visited.has(id)) return false
        visiting.add(id)
        for (const dependency of tasks.get(id)?.dependsOn ?? []) if (visit(dependency)) return true
        visiting.delete(id)
        visited.add(id)
        return false
      }
      return [...tasks.keys()].some(visit)
    }
    if (hasCycle()) return yield* Effect.fail(new Error("Cascade plan contains a dependency cycle"))

    const results = new Map<TaskID, TaskResult>()
    const artifacts = new Map<string, unknown>()
    if (options.resume) {
      for (const [id, result] of options.resume.results) {
        if (tasks.has(id) && result.state === "completed") results.set(id, result)
      }
      for (const [key, value] of options.resume.artifacts) artifacts.set(key, value)
    }

    const emit = (event: Event) => options.onEvent ? options.onEvent(event) : Effect.void
    if (options.resume) yield* emit({ type: "cascade.resumed", completedCount: results.size })
    yield* emit({
      type: "cascade.started",
      taskCount: tasks.size,
      tasks: [...tasks.values()].map(({ run: _run, ...task }) => task),
    })

    const executeTask = (task: Task) =>
      Effect.gen(function* () {
        const maxAttempts = Math.max(1, (task.retries ?? 0) + 1)
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          yield* emit({ type: "cascade.task.started", taskID: task.id, attempt })
          const outcome = yield* Effect.gen(function* () {
            const capability = task.capability ? capabilities.get(task.capability) : undefined
            if (capability?.activate) yield* capability.activate
            return yield* task.run({ taskID: task.id, artifacts: new Map(artifacts), capability, attempt })
          }).pipe(Effect.matchEffect({
            onSuccess: (taskArtifacts) => Effect.succeed({ ok: true as const, taskArtifacts }),
            onFailure: (error) => Effect.succeed({ ok: false as const, error }),
          }))
          if (outcome.ok) return { state: "completed" as const, artifacts: outcome.taskArtifacts, attempts: attempt }
          if (attempt < maxAttempts) {
            yield* emit({ type: "cascade.task.retrying", taskID: task.id, attempt, error: outcome.error })
            continue
          }
          return { state: "failed" as const, artifacts: [] as readonly Artifact[], attempts: attempt, error: outcome.error }
        }
        return { state: "failed" as const, artifacts: [] as readonly Artifact[], attempts: maxAttempts, error: new Error("Cascade task exhausted retries") }
      })

    try {
      while (results.size < tasks.size) {
        const ready = [...tasks.values()].filter((task) =>
          !results.has(task.id) &&
          (task.dependsOn ?? []).every((dependency) => results.get(dependency)?.state === "completed"),
        )
        const blocked = [...tasks.values()].filter((task) =>
          !results.has(task.id) &&
          (task.dependsOn ?? []).some((dependency) => {
            const state = results.get(dependency)?.state
            return state === "failed" || state === "cancelled"
          }),
        )
        for (const task of blocked) {
          const error = new Error(`Dependency failed for Cascade task ${task.id}`)
          results.set(task.id, { id: task.id, state: "cancelled", artifacts: [], error, attempts: 0 })
          yield* emit({ type: "cascade.task.cancelled", taskID: task.id, reason: error.message })
        }
        if (ready.length === 0) {
          if (results.size < tasks.size) return yield* Effect.fail(new Error("Cascade plan cannot make further progress"))
          break
        }

        const wave = ready.slice(0, concurrency)
        const completed = yield* Effect.forEach(wave, executeTask, { concurrency })
        for (const [index, result] of completed.entries()) {
          const task = wave[index]
          const taskResult: TaskResult = { id: task.id, state: result.state, artifacts: result.artifacts, attempts: result.attempts, ...(result.state === "failed" ? { error: result.error } : {}) }
          results.set(task.id, taskResult)
          if (result.state === "completed") {
            for (const artifact of result.artifacts) {
              artifacts.set(artifact.key, artifact.value)
              yield* emit({ type: "cascade.task.artifact", taskID: task.id, key: artifact.key, kind: artifact.kind })
            }
            yield* emit({ type: "cascade.task.completed", taskID: task.id, artifactCount: result.artifacts.length, attempts: result.attempts, artifacts: result.artifacts })
          } else {
            yield* emit({ type: "cascade.task.failed", taskID: task.id, error: result.error, attempts: result.attempts })
          }
        }
      }
      yield* emit({ type: "cascade.completed", results })
      return { results, artifacts }
    } catch (error) {
      const reason = errorMessage(error)
      yield* emit({ type: "cascade.cancelled", reason })
      return yield* Effect.fail(error instanceof Error ? error : new Error(reason))
    }
  }).pipe(
    Effect.onInterrupt(() => options.onEvent ? options.onEvent({ type: "cascade.cancelled", reason: "interrupted" }) : Effect.void),
  )
