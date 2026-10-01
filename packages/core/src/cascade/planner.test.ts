import { describe, expect, test } from "bun:test"
import { plan } from "./planner"

describe("Cascade planner", () => {
  test("builds a multi-agent graph for a complex implementation request", () => {
    const result = plan({
      request: "Implement authentication, add tests, review security, and update the documentation.",
    })

    const ids = result.tasks.map((task) => task.id)
    expect(ids).toContain("implementation")
    expect(ids).toContain("verification")
    expect(ids).toContain("security")
    expect(ids).toContain("documentation")
    expect(ids).toContain("__cascade_synthesis__")

    const verification = result.tasks.find((task) => task.id === "verification")
    expect(verification?.dependsOn).toEqual(["implementation"])
  })

  test("keeps a simple request small", () => {
    const result = plan({
      request: "Fix the broken login button.",
    })

    expect(result.tasks.map((task) => task.id)).toEqual(["implementation", "verification", "__cascade_synthesis__"])
  })

  test("research feeds implementation", () => {
    const result = plan({
      request: "Research the existing API architecture and implement a migration plan.",
    })

    const implementation = result.tasks.find((task) => task.id === "implementation")
    expect(implementation?.dependsOn).toEqual(["research"])
  })
})
