import { describe, expect, test } from "bun:test"
import { capabilities, get, list, toCascade } from "./capability"

describe("Cascade capability registry", () => {
  test("exposes stable specialist roles", () => {
    const roles = list()

    expect(roles.map((role) => role.id)).toEqual([
      "researcher",
      "developer",
      "tester",
      "reviewer",
      "security",
      "documenter",
    ])
    expect(get("developer")?.agent).toBe("general")
    expect(get("researcher")?.mutatesWorkspace).toBe(false)
    expect(get("developer")?.mutatesWorkspace).toBe(true)
  })

  test("maps registered roles to Cascade capabilities", () => {
    const developer = get("developer")
    expect(developer).toBeDefined()
    expect(toCascade(developer!).id).toBe("developer")
    expect(capabilities().map((capability) => capability.id)).toContain("security")
  })
})
