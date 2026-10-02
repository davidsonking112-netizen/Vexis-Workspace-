import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import { Cascade } from "./cascade"

describe("Cascade", () => {
  it("runs independent tasks in parallel and dependency tasks afterward", async () => {
    const order: string[] = []

    const result = await Effect.runPromise(
      Cascade.run(
        {
          tasks: [
            {
              id: "research",
              run: () => Effect.sync(() => {
                order.push("research")
                return [{ key: "research", value: "done", taskID: "research" }]
              }),
            },
            {
              id: "inspect",
              run: () => Effect.sync(() => {
                order.push("inspect")
                return [{ key: "inspect", value: "done", taskID: "inspect" }]
              }),
            },
            {
              id: "synthesize",
              dependsOn: ["research", "inspect"],
              run: ({ artifacts }) => Effect.sync(() => {
                expect(artifacts.get("research")).toBe("done")
                expect(artifacts.get("inspect")).toBe("done")
                return [{ key: "summary", value: "ready", taskID: "synthesize" }]
              }),
            },
          ],
        },
        { concurrency: 2 },
      ),
    )

    expect(result.artifacts.get("summary")).toBe("ready")
    expect(result.results.get("synthesize")?.state).toBe("completed")
    expect(result.concurrency).toBe(2)
    expect(order).toEqual(["research", "inspect", "synthesize"])
  })

  it("activates only capabilities required by a task", async () => {
    let activated = 0

    const result = await Effect.runPromise(
      Cascade.run({
        capabilities: [
          {
            id: "browser",
            activate: Effect.sync(() => {
              activated += 1
            }),
          },
        ],
        tasks: [
          {
            id: "web",
            capability: "browser",
            run: ({ capability }) => Effect.sync(() => {
              expect(capability?.id).toBe("browser")
              return [{ key: "page", value: "loaded", taskID: "web" }]
            }),
          },
        ],
      }),
    )

    expect(activated).toBe(1)
    expect(result.results.get("web")?.state).toBe("completed")
  })

  it("rejects cycles and missing dependencies", async () => {
    await expect(
      Effect.runPromise(
        Cascade.run({
          tasks: [
            { id: "a", dependsOn: ["missing"], run: () => Effect.succeed([]) },
          ],
        }),
      ),
    ).rejects.toThrow("missing task")

    await expect(
      Effect.runPromise(
        Cascade.run({
          tasks: [
            { id: "a", dependsOn: ["b"], run: () => Effect.succeed([]) },
            { id: "b", dependsOn: ["a"], run: () => Effect.succeed([]) },
          ],
        }),
      ),
    ).rejects.toThrow("dependency cycle")
  })

  it("normalizes invalid scheduler concurrency safely", async () => {
    const cases = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 2.9]
    for (const concurrency of cases) {
      const result = await Effect.runPromise(
        Cascade.run(
          { tasks: [{ id: "task", run: () => Effect.succeed([]) }] },
          { concurrency },
        ),
      )
      expect(Number.isInteger(result.concurrency)).toBe(true)
      expect(result.concurrency).toBeGreaterThanOrEqual(1)
    }
    const fractional = await Effect.runPromise(
      Cascade.run(
        { tasks: [{ id: "task", run: () => Effect.succeed([]) }] },
        { concurrency: 2.9 },
      ),
    )
    expect(fractional.concurrency).toBe(2)
  })

})
