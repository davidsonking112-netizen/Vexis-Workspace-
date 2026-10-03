import { describe, expect, test } from "bun:test"
import { Effect, Fiber } from "effect"
import { run } from "./cascade"

describe("Cascade events", () => {
  test("emits lifecycle events in execution order", async () => {
    const events: string[] = []
    const result = await Effect.runPromise(
      run(
        {
          tasks: [
            { id: "research", run: () => Effect.succeed([{ key: "research", value: "done", taskID: "research" }]) },
            { id: "build", dependsOn: ["research"], run: () => Effect.succeed([]) },
          ],
        },
        {
          onEvent: (event) =>
            Effect.sync(() => {
              events.push(event.type + ("taskID" in event ? ":" + event.taskID : ""))
            }),
        },
      ),
    )

    expect(result.results.get("build")?.state).toBe("completed")
    expect(events).toEqual([
      "cascade.started",
      "cascade.task.started:research",
      "cascade.task.completed:research",
      "cascade.task.started:build",
      "cascade.task.completed:build",
      "cascade.completed",
    ])
  })

  test("emits terminal cancellation for running tasks when interrupted", async () => {
    const events: string[] = []
    let resolveStarted!: () => void
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve
    })

    const fiber = Effect.runFork(
      run(
        {
          tasks: [
            {
              id: "blocked",
              run: () => Effect.never,
            },
          ],
        },
        {
          onEvent: (event) =>
            Effect.sync(() => {
              events.push(event.type + ("taskID" in event ? ":" + event.taskID : ""))
              if (event.type === "cascade.task.started") resolveStarted()
            }),
        },
      ),
    )

    await started
    await Effect.runPromise(Fiber.interrupt(fiber))
    expect(events).toContain("cascade.task.started:blocked")
    expect(events).toContain("cascade.task.cancelled:blocked")
    expect(events).toContain("cascade.cancelled")
  })

  test("does not abort execution when a lifecycle observer defects", async () => {
    const result = await Effect.runPromise(
      run(
        {
          tasks: [
            { id: "safe", run: () => Effect.succeed([]) },
          ],
        },
        {
          onEvent: () => Effect.die(new Error("observer crashed")),
        },
      ),
    )

    expect(result.results.get("safe")?.state).toBe("completed")
  })
})
