import type { Capability } from "../cascade"

export type CapabilityRole = {
  readonly id: string
  readonly description: string
  readonly agent: string
  readonly capabilities: readonly string[]
  readonly mutatesWorkspace: boolean
  readonly artifactKinds: readonly ("result" | "change" | "snapshot" | "test" | "review" | "report")[]
}

const roles: readonly CapabilityRole[] = [
  { id: "researcher", description: "Investigates the repository, external references, requirements, and constraints before implementation.", agent: "explore", capabilities: ["repository", "web"], mutatesWorkspace: false, artifactKinds: ["report"] },
  { id: "developer", description: "Implements or modifies the requested behavior in the workspace.", agent: "general", capabilities: ["repository", "terminal", "editing"], mutatesWorkspace: true, artifactKinds: ["change", "result"] },
  { id: "tester", description: "Validates implementation with tests, checks, and reproducible verification steps.", agent: "general", capabilities: ["repository", "terminal", "testing"], mutatesWorkspace: false, artifactKinds: ["test", "report"] },
  { id: "reviewer", description: "Reviews the resulting work for correctness, regressions, maintainability, and edge cases.", agent: "general", capabilities: ["repository", "review"], mutatesWorkspace: false, artifactKinds: ["review", "report"] },
  { id: "security", description: "Audits security-sensitive behavior, permissions, secrets, auth, and trust boundaries.", agent: "general", capabilities: ["repository", "security"], mutatesWorkspace: false, artifactKinds: ["review", "report"] },
  { id: "documenter", description: "Updates documentation and user-facing project guidance to match the implementation.", agent: "general", capabilities: ["repository", "editing", "documentation"], mutatesWorkspace: true, artifactKinds: ["change", "report"] },
]

export const list = (): readonly CapabilityRole[] => roles
export const get = (id: string): CapabilityRole | undefined => roles.find((role) => role.id === id)
export const toCascade = (role: CapabilityRole): Capability => ({ id: role.id, description: role.description })
export const capabilities = (): readonly Capability[] => roles.map(toCascade)
