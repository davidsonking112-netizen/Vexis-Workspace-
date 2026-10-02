import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { run, type Artifact } from "./cascade"

const artifact = (taskID: string, key: string, value: unknown): Artifact => ({
  taskID,
  key,
  value,
  kind: "result",
})

describe("Cascade recovery", () => {
  test("retries failed tasks and preserves their artifacts for dependents", async () => {
    let attempts = 0
    const events: string[] = []

    const result = await Effect.runPromise(
      run(
        {
          tasks: [
            {
              id: "research",
              retries: 1,
              run: () => {
                attempts++
                return attempts === 1
                  ? Effect.fail(new Error("transient"))
                  : Effect.succeed([artifact("research", "finding", "ready")])
              },
            },
            {
              id: "build",
              dependsOn: ["research"],
              run: ({ artifacts }) => Effect.succeed([artifact("build", "seen", artifacts.get("finding"))]),
            },
          ],
        },
        {
          onEvent: (event) =>
            Effect.sync(() => {
              events.push(event.type)
            }),
        },
      ),
    )

    expect(attempts).toBe(2)
    expect(result.results.get("research")?.state).toBe("completed")
    expect(result.artifacts.get("seen")).toBe("ready")
    expect(events).toContain("cascade.task.retrying")
  })

  test("resumes completed work without rerunning it", async () => {
    let researchRuns = 0
    let buildRuns = 0
    const first = {
      results: new Map([
        ["research", { id: "research", state: "completed" as const, artifacts: [artifact("research", "finding", "cached")] }],
      ]),
      artifacts: new Map([["finding", "cached"]]),
    }

    const result = await Effect.runPromise(
      run(
        {
          tasks: [
            {
              id: "research",
              run: () => {
                researchRuns++
                return Effect.succeed([artifact("research", "finding", "fresh")])
              },
            },
            {
              id: "build",
              dependsOn: ["research"],
              run: ({ artifacts }) => {
                buildRuns++
                return Effect.succeed([artifact("build", "seen", artifacts.get("finding"))])
              },
            },
          ],
        },
        { resume: first },
      ),
    )

    expect(researchRuns).toBe(0)
    expect(buildRuns).toBe(1)
    expect(result.artifacts.get("seen")).toBe("cached")
  })

  test("cancels downstream work after an unrecoverable failure", async () => {
    const result = await Effect.runPromise(
      run({
        tasks: [
          { id: "broken", run: () => Effect.fail(new Error("fatal")) },
          { id: "dependent", dependsOn: ["broken"], run: () => Effect.succeed([]) },
        ],
      }),
    )

    expect(result.results.get("broken")?.state).toBe("failed")
    expect(result.results.get("dependent")?.state).toBe("cancelled")
  })
})
