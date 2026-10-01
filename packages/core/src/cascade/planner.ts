import type { Plan, Task } from "../cascade"
import { get as getRole } from "./capability"

export type Mission = {
  readonly request: string
  readonly includeSynthesis?: boolean
}

const has = (text: string, pattern: RegExp) => pattern.test(text)

const addTask = (
  tasks: Task[],
  task: Omit<Task, "run"> & { run?: Task["run"] },
) => {
  tasks.push({
    ...task,
    run: task.run ?? (() => {
      throw new Error("Cascade planner tasks must be executed by CascadeSession")
    }),
  })
}

/**
 * Builds a deterministic first-pass mission graph from a natural-language request.
 *
 * The planner deliberately stays provider/model independent. It decides which
 * specialist roles are needed; the normal Vexis agent runtime remains responsible
 * for reasoning and execution inside each node.
 */
export const plan = (mission: Mission): Plan => {
  const request = mission.request.trim()
  if (!request) throw new Error("Mission request cannot be empty")

  const text = request.toLowerCase()
  const tasks: Task[] = []

  const research = has(text, /research|investigate|analy[sz]e|explore|understand|requirements|compare|find out/)
  const testing = has(text, /test|tests|testing|coverage|verify|validate|regression|benchmark/)
  const security = has(text, /security|secure|vulnerab|auth|authentication|authorization|permission|secret|credential/)
  const docs = has(text, /document|documentation|docs|readme|guide|changelog/)
  const architecture = has(text, /architect|architecture|design|redesign|refactor|migrat/)
  const implementation = has(text, /build|implement|add|create|fix|change|modify|update|refactor|migrat|ship|develop/)
  const complex = request.length > 180 || [research, testing, security, docs, architecture].filter(Boolean).length >= 2

  if (research || architecture || complex) {
    const role = getRole("researcher")!
    addTask(tasks, {
      id: "research",
      title: "Research and understand the workspace",
      prompt: [
        "Investigate the request before making changes.",
        request,
        "Inspect the relevant repository structure and existing implementation. Identify constraints, affected files, existing patterns, and a concrete implementation approach.",
        "Do not make broad unrelated changes.",
      ].join("\n\n"),
      agent: role.agent,
      capability: role.id,
    })
  }

  const shouldImplement = implementation || !research && !testing && !security && !docs
  if (shouldImplement) {
    const role = getRole("developer")!
    addTask(tasks, {
      id: "implementation",
      title: "Implement the requested change",
      prompt: [
        "Implement the user's request in the workspace.",
        request,
        "Use upstream research artifacts when present. Keep the change focused, follow existing project conventions, and leave the workspace in a coherent state.",
      ].join("\n\n"),
      agent: role.agent,
      capability: role.id,
      dependsOn: tasks.some((task) => task.id === "research") ? ["research"] : [],
    })
  }

  if (testing || complex || shouldImplement) {
    const role = getRole("tester")!
    addTask(tasks, {
      id: "verification",
      title: "Verify the implementation",
      prompt: [
        "Validate the work produced for this mission.",
        request,
        "Inspect the resulting changes, run the most relevant available tests or checks, and report failures, regressions, or remaining uncertainty. Fix only verification issues that are clearly part of the request.",
      ].join("\n\n"),
      agent: role.agent,
      capability: role.id,
      dependsOn: shouldImplement ? ["implementation"] : tasks.length ? [tasks[tasks.length - 1].id] : [],
    })
  }

  if (security) {
    const role = getRole("security")!
    addTask(tasks, {
      id: "security",
      title: "Review security and trust boundaries",
      prompt: [
        "Perform a focused security review for the mission.",
        request,
        "Look for permission, authentication, authorization, secret-handling, injection, data exposure, and trust-boundary issues relevant to the requested change. Report concrete findings and fixes.",
      ].join("\n\n"),
      agent: role.agent,
      capability: role.id,
      dependsOn: shouldImplement ? ["implementation"] : tasks.length ? [tasks[tasks.length - 1].id] : [],
    })
  }

  if (docs) {
    const role = getRole("documenter")!
    addTask(tasks, {
      id: "documentation",
      title: "Update documentation",
      prompt: [
        "Update documentation required by the mission.",
        request,
        "Keep documentation accurate and concise. Reflect the actual implementation and user-facing behavior rather than describing aspirational features.",
      ].join("\n\n"),
      agent: role.agent,
      capability: role.id,
      dependsOn: shouldImplement ? ["implementation"] : tasks.length ? [tasks[tasks.length - 1].id] : [],
    })
  }

  const reviewDependencies = tasks.filter((task) => task.id !== "research").map((task) => task.id)
  if (complex && reviewDependencies.length > 1) {
    const role = getRole("reviewer")!
    addTask(tasks, {
      id: "review",
      title: "Review the complete mission",
      prompt: [
        "Review the complete mission result.",
        request,
        "Cross-check the implementation against the research and verification artifacts. Identify inconsistencies, missing requirements, regressions, or unnecessary changes.",
      ].join("\n\n"),
      agent: role.agent,
      capability: role.id,
      dependsOn: reviewDependencies,
    })
  }

  if (tasks.length === 0) {
    const role = getRole("developer")!
    addTask(tasks, {
      id: "implementation",
      title: "Execute mission",
      prompt: request,
      agent: role.agent,
      capability: role.id,
    })
  }

  if (mission.includeSynthesis !== false) {
    const dependencyIds = tasks.map((task) => task.id)
    const role = getRole("reviewer")!
    addTask(tasks, {
      id: "__cascade_synthesis__",
      title: "Synthesize mission results",
      prompt: [
        "Synthesize the mission artifacts into a concise final report.",
        request,
        "Summarize what changed, verification performed, important findings, remaining risks, and any follow-up work. Do not claim work was completed unless an upstream artifact supports it.",
      ].join("\n\n"),
      agent: role.agent,
      capability: role.id,
      dependsOn: dependencyIds,
    })
  }

  return { tasks }
}
