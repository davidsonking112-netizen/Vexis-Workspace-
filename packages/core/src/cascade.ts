export * as Cascade from "./cascade"
export * as CascadeSession from "./cascade/session"

import { Effect } from "effect"

export type TaskID = string

export type Capability = {
  readonly id: string
  readonly description?: string
  readonly activate?: Effect.Effect<void, unknown>
}

export type Artifact = {
  readonly key: string
  readonly value: unknown
  readonly taskID: TaskID
}

export type TaskContext = {
  readonly taskID: TaskID
  readonly artifacts: ReadonlyMap<string, unknown>
  readonly capability: Capability | undefined
}

export type Task = {
  readonly id: TaskID
  readonly title?: string
  readonly capability?: string
  readonly agent?: string
  readonly dependsOn?: readonly TaskID[]
  readonly run: (context: TaskContext) => Effect.Effect<readonly Artifact[], unknown>
}

export type TaskState = "pending" | "running" | "completed" | "failed" | "cancelled"

export type TaskResult = {
  readonly id: TaskID
  readonly state: TaskState
  readonly error?: unknown
  readonly artifacts: readonly Artifact[]
}

export type ProjectResult = {
  readonly results: ReadonlyMap<TaskID, TaskResult>
  readonly artifacts: ReadonlyMap<string, unknown>
}

export type Plan = {
  readonly tasks: readonly Task[]
  readonly capabilities?: readonly Capability[]
}

export type Options = {
  readonly concurrency?: number
  readonly capabilities?: readonly Capability[]
}

/**
 * Vexis Cascade is the project-level execution primitive behind multi-agent work.
 *
 * It keeps the project graph small until a task needs a capability, then activates
 * that capability and executes independent tasks in parallel. Completed artifacts
 * become inputs to later dependency waves.
 *
 * This intentionally does not copy Manus's proprietary implementation; it provides
 * the same architectural shape as a public Vexis orchestration API.
 */
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
        if (!tasks.has(dependency)) {
          return yield* Effect.fail(new Error(`Cascade task ${task.id} depends on missing task ${dependency}`))
        }
      }
      if (task.capability && !capabilities.has(task.capability)) {
        return yield* Effect.fail(new Error(`Cascade task ${task.id} requires unavailable capability ${task.capability}`))
      }
    }

    const results = new Map<TaskID, TaskResult>()
    const artifacts = new Map<string, unknown>()

    const hasCycle = () => {
      const visiting = new Set<TaskID>()
      const visited = new Set<TaskID>()
      const visit = (id: TaskID): boolean => {
        if (visiting.has(id)) return true
        if (visited.has(id)) return false
        visiting.add(id)
        for (const dependency of tasks.get(id)?.dependsOn ?? []) {
          if (visit(dependency)) return true
        }
        visiting.delete(id)
        visited.add(id)
        return false
      }
      return [...tasks.keys()].some(visit)
    }

    if (hasCycle()) return yield* Effect.fail(new Error("Cascade plan contains a dependency cycle"))

    while (results.size < tasks.size) {
      const ready = [...tasks.values()].filter((task) => {
        if (results.has(task.id)) return false
        return (task.dependsOn ?? []).every((dependency) => results.get(dependency)?.state === "completed")
      })

      const blocked = [...tasks.values()].filter((task) => {
        if (results.has(task.id)) return false
        return (task.dependsOn ?? []).some((dependency) => {
          const state = results.get(dependency)?.state
          return state === "failed" || state === "cancelled"
        })
      })

      for (const task of blocked) {
        results.set(task.id, {
          id: task.id,
          state: "cancelled",
          artifacts: [],
          error: new Error(`Dependency failed for Cascade task ${task.id}`),
        })
      }

      if (ready.length === 0) {
        if (results.size < tasks.size) {
          return yield* Effect.fail(new Error("Cascade plan cannot make further progress"))
        }
        break
      }

      const wave = ready.slice(0, concurrency)
      for (const task of wave) {
        results.set(task.id, { id: task.id, state: "running", artifacts: [] })
      }

      const completed = yield* Effect.forEach(
        wave,
        (task) =>
          Effect.gen(function* () {
            const capability = task.capability ? capabilities.get(task.capability) : undefined
            if (capability?.activate) yield* capability.activate

            const taskArtifacts = yield* task.run({
              taskID: task.id,
              artifacts: new Map(artifacts),
              capability,
            })
            return { task, taskArtifacts }
          }).pipe(
            Effect.matchEffect({
              onSuccess: ({ task, taskArtifacts }) =>
                Effect.succeed({
                  id: task.id,
                  state: "completed" as const,
                  artifacts: taskArtifacts,
                }),
              onFailure: (error) =>
                Effect.succeed({
                  id: task.id,
                  state: "failed" as const,
                  artifacts: [],
                  error,
                }),
            }),
          ),
        { concurrency },
      )

      for (const result of completed) {
        results.set(result.id, result)
        if (result.state === "completed") {
          for (const artifact of result.artifacts) artifacts.set(artifact.key, artifact.value)
        }
      }
    }

    return { results, artifacts }
  })
