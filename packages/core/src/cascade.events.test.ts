import { describe, expect, test } from "bun:test"
import { Deferred, Effect, Fiber } from "effect"
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

  test("reports interrupted tasks before the cascade cancellation event", async () => {
    const events: string[] = []
    const started = Deferred.makeUnsafe<void>()
    const fiber = Effect.runFork(
      run(
        {
          tasks: [{ id: "slow", run: () => Effect.never }],
        },
        {
          onEvent: (event) =>
            Effect.sync(() => {
              events.push(event.type)
              if (event.type === "cascade.task.started") Deferred.doneUnsafe(started, Effect.void)
            }),
        },
      ),
    )

    await Effect.runPromise(Deferred.await(started))
    await Effect.runPromise(Fiber.interrupt(fiber))

    expect(events).toContain("cascade.task.cancelled")
    expect(events.at(-1)).toBe("cascade.cancelled")
  })

})
