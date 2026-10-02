import { For, Show, createMemo, createResource, createSignal, onCleanup, onMount } from "solid-js"
import { Icon } from "@vexis/ui/icon"
import { useParams } from "@solidjs/router"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"

type CascadeMetadata = {
  taskID?: string
  role?: string
  dependsOn?: string[]
  parentSessionID?: string
  git?: { isolated?: boolean; head?: string; branch?: string; dirtyBase?: boolean }
}

type CascadeEvent = {
  id: string
  type: string
  data: {
    timestamp?: unknown
    sessionID: string
    taskID?: string
    role?: string
    attempt?: number
    completedCount?: number
    taskCount?: number
    key?: string
    kind?: string
    label?: string
    reason?: string
    attempts?: number
    error?: unknown
    artifacts?: Array<{ key: string; value: unknown; taskID: string; kind?: string; label?: string }>
    tasks?: Array<{
      id: string
      title?: string
      prompt?: string
      role?: string
      agent?: string
      capability?: string
      dependsOn?: string[]
      retries?: number
      mutatesWorkspace?: boolean
    }>
  }
}

function cascadeMetadata(value: unknown): CascadeMetadata | undefined {
  if (!value || typeof value !== "object") return undefined
  const cascade = (value as { cascade?: unknown }).cascade
  if (!cascade || typeof cascade !== "object") return undefined
  return cascade as CascadeMetadata
}

function eventTime(event: CascadeEvent) {
  const value = event.data.timestamp
  if (typeof value === "number") return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  return ""
}

function errorText(value: unknown) {
  if (typeof value === "string") return value
  if (value && typeof value === "object" && "message" in value) return String((value as { message: unknown }).message)
  return String(value ?? "Unknown error")
}

const labelForEvent: Record<string, string> = {
  "session.next.cascade.started": "Mission started",
  "session.next.cascade.resumed": "Mission resumed",
  "session.next.cascade.task.started": "Task started",
  "session.next.cascade.task.retrying": "Task retrying",
  "session.next.cascade.task.artifact": "Artifact created",
  "session.next.cascade.task.completed": "Task completed",
  "session.next.cascade.task.failed": "Task failed",
  "session.next.cascade.task.cancelled": "Task cancelled",
  "session.next.cascade.cancelled": "Mission cancelled",
  "session.next.cascade.completed": "Mission completed",
}

export function CascadePanel() {
  const params = useParams<{ id: string }>()
  const sync = useServerSync()
  const sdk = useServerSDK()
  const [open, setOpen] = createSignal(false)
  const [busy, setBusy] = createSignal<"resume" | "cancel" | undefined>()
  const [liveEvents, setLiveEvents] = createSignal<CascadeEvent[]>([])

  const graph = createMemo(() => {
    const info = sync().session.data.info
    const current = info[params.id]
    if (!current) return undefined
    let root = current
    const seen = new Set<string>()
    while (root.parentID && !seen.has(root.id)) {
      seen.add(root.id)
      const parent = info[root.parentID]
      if (!parent) break
      root = parent
    }
    const tasks = Object.values(info)
      .filter((item): item is NonNullable<typeof item> => !!item)
      .map((item) => ({ item, metadata: cascadeMetadata(item.metadata) }))
      .filter(({ item, metadata }) => metadata?.parentSessionID === root.id || item.parentID === root.id)
      .sort((a, b) => (a.metadata?.taskID ?? a.item.id).localeCompare(b.metadata?.taskID ?? b.item.id))
    return { root, tasks }
  })

  const [history, { refetch }] = createResource(
    () => (open() ? graph()?.root.id : undefined),
    async (sessionID) => {
      if (!sessionID) return [] as CascadeEvent[]
      const result = await sdk().api.session.history({ sessionID, query: { limit: 100 } })
      return (result.data as unknown as CascadeEvent[]).filter((event) => event.type.startsWith("session.next.cascade."))
    },
  )

  onMount(() => {
    const stop = sdk().event.listen((event) => {
      if (!event.type.startsWith("session.next.cascade.")) return
      const properties = event.properties as CascadeEvent["data"]
      if (properties.sessionID !== graph()?.root.id) return
      setLiveEvents((current) => {
        if (current.some((item) => item.id === event.id)) return current
        return [...current, { id: event.id, type: event.type, data: properties }]
      })
    })
    onCleanup(stop)
  })

  const events = createMemo(() => {
    const persisted = history() ?? []
    const merged = new Map<string, CascadeEvent>()
    for (const event of persisted) merged.set(event.id, event)
    for (const event of liveEvents()) merged.set(event.id, event)
    return [...merged.values()]
  })
  const mission = createMemo(() => {
    const items = events()
    const started = items.toReversed().find((event) => event.type === "session.next.cascade.started")
    const completed = items.some((event) => event.type === "session.next.cascade.completed")
    const cancelled = items.some((event) => event.type === "session.next.cascade.cancelled")
    const taskIDs = new Set(started?.data.tasks?.map((task) => task.id) ?? [])
    const taskState = new Map<string, { state: string; attempt?: number; error?: unknown; artifacts: number }>()
    for (const event of items) {
      const id = event.data.taskID
      if (!id || (taskIDs.size > 0 && !taskIDs.has(id))) continue
      if (event.type === "session.next.cascade.task.started") taskState.set(id, { state: "running", attempt: event.data.attempt, artifacts: taskState.get(id)?.artifacts ?? 0 })
      if (event.type === "session.next.cascade.task.retrying") taskState.set(id, { state: "retrying", attempt: event.data.attempt, artifacts: taskState.get(id)?.artifacts ?? 0 })
      if (event.type === "session.next.cascade.task.artifact") {
        const current = taskState.get(id) ?? { state: "running", artifacts: 0 }
        taskState.set(id, { ...current, artifacts: current.artifacts + 1 })
      }
      if (event.type === "session.next.cascade.task.completed") taskState.set(id, { state: "completed", attempt: event.data.attempts, artifacts: event.data.artifacts?.length ?? 0 })
      if (event.type === "session.next.cascade.task.failed") taskState.set(id, { state: "failed", attempt: event.data.attempts, error: event.data.error, artifacts: 0 })
      if (event.type === "session.next.cascade.task.cancelled") taskState.set(id, { state: "cancelled", error: event.data.reason, artifacts: 0 })
    }
    const tasks = started?.data.tasks ?? graph()?.tasks.map((node) => ({
      id: node.metadata?.taskID ?? node.item.id,
      title: node.item.title,
      role: node.metadata?.role,
      dependsOn: node.metadata?.dependsOn,
    })) ?? []
    return {
      started,
      tasks,
      taskState,
      completedCount: [...taskState.values()].filter((task) => task.state === "completed").length,
      failedCount: [...taskState.values()].filter((task) => task.state === "failed").length,
      runningCount: [...taskState.values()].filter((task) => task.state === "running" || task.state === "retrying").length,
      completed,
      cancelled,
    }
  })

  const artifacts = createMemo(() =>
    events()
      .filter((event) => event.type === "session.next.cascade.task.completed")
      .flatMap((event) => (event.data.artifacts ?? []).map((artifact) => ({ ...artifact, taskID: event.data.taskID ?? artifact.taskID }))),
  )

  const action = async (kind: "resume" | "cancel") => {
    const sessionID = graph()?.root.id
    if (!sessionID) return
    setBusy(kind)
    try {
      if (kind === "resume") await sdk().api.cascade.resume({ sessionID })
      else await sdk().api.cascade.cancel({ sessionID })
      await refetch()
    } finally {
      setBusy()
    }
  }

  return (
    <Show when={graph()?.tasks.length || mission()?.started}>
      <div class="absolute top-3 end-3 z-30">
        <Show when={open()} fallback={
          <button type="button" class="h-9 px-3 rounded-md border border-border-base bg-background-stronger text-12-medium text-text-base shadow-lg flex items-center gap-2" onClick={() => setOpen(true)}>
            <Icon name="models" size="14" /> Agents <span class="text-text-weak">{mission()?.tasks.length ?? graph()?.tasks.length ?? 0}</span>
          </button>
        }>
          <div class="w-[520px] max-h-[82vh] overflow-hidden rounded-xl border border-border-base bg-background-base shadow-2xl">
            <div class="px-4 py-3 border-b border-border-weaker-base flex items-center gap-3">
              <div class="size-8 rounded-lg bg-background-stronger flex items-center justify-center"><Icon name="models" size="16" /></div>
              <div class="min-w-0 flex-1">
                <div class="text-13-medium text-text-base">Vexis Mission</div>
                <div class="text-11-regular text-text-weak">{mission()?.completedCount ?? 0}/{mission()?.tasks.length ?? 0} tasks completed</div>
              </div>
              <Show when={mission()?.runningCount}><span class="text-10-medium text-icon-info">RUNNING</span></Show>
              <Show when={!mission()?.runningCount && mission()?.failedCount}><span class="text-10-medium text-icon-error">FAILED</span></Show>
              <Show when={mission()?.completed && !mission()?.runningCount}><span class="text-10-medium text-icon-success">COMPLETE</span></Show>
              <button type="button" class="size-7 rounded hover:bg-background-stronger flex items-center justify-center" onClick={() => setOpen(false)} aria-label="Close Mission panel">
                <Icon name="xmark-small" size="14" />
              </button>
            </div>

            <div class="px-4 py-2 border-b border-border-weaker-base flex items-center gap-2">
              <Show when={mission()?.runningCount}>
                <button type="button" class="px-2.5 py-1.5 rounded-md border border-border-base text-11-medium hover:bg-background-stronger" disabled={!!busy()} onClick={() => void action("cancel")}>
                  {busy() === "cancel" ? "Cancelling…" : "Cancel"}
                </button>
              </Show>
              <Show when={mission()?.failedCount || mission()?.cancelled}>
                <button type="button" class="px-2.5 py-1.5 rounded-md bg-background-stronger text-11-medium hover:bg-background-stronger" disabled={!!busy()} onClick={() => void action("resume")}>
                  {busy() === "resume" ? "Resuming…" : mission()?.cancelled ? "Resume mission" : "Retry failed"}
                </button>
              </Show>
              <Show when={!history.loading}>
                <button type="button" class="ms-auto px-2 py-1.5 rounded-md text-11-regular text-text-weak hover:bg-background-stronger" onClick={() => void refetch()}>Refresh</button>
              </Show>
            </div>

            <div class="max-h-[58vh] overflow-auto p-3 flex flex-col gap-3">
              <section>
                <div class="text-11-medium text-text-weak uppercase tracking-wide mb-2">Agent Team</div>
                <div class="flex flex-col gap-1.5">
                  <For each={mission()?.tasks ?? []}>
                    {(task) => {
                      const state = () => mission()?.taskState.get(task.id)
                      const done = () => state()?.state === "completed"
                      const failed = () => state()?.state === "failed"
                      const running = () => state()?.state === "running" || state()?.state === "retrying"
                      return (
                        <div class="rounded-lg border border-border-weaker-base bg-background-stronger px-3 py-2.5">
                          <div class="flex items-center gap-2">
                            <span class="size-2 rounded-full" classList={{ "bg-icon-success": done(), "bg-icon-error": failed(), "bg-icon-info": running(), "bg-icon-warning": !done() && !failed() && !running() }} />
                            <span class="text-12-medium text-text-base truncate">{task.id}</span>
                            <span class="ms-auto text-10-regular text-text-weak">{state()?.state ?? "pending"}</span>
                          </div>
                          <div class="flex items-center gap-2 mt-1">
                            <span class="text-11-medium text-text-base">{task.role ?? "worker"}</span>
                            <Show when={state()?.attempt}><span class="text-10-regular text-text-faint">attempt {state()?.attempt}</span></Show>
                          </div>
                          <Show when={task.title}><div class="text-10-regular text-text-weak mt-1 truncate">{task.title}</div></Show>
                          <Show when={task.dependsOn?.length}><div class="text-10-regular text-text-faint mt-1">depends on: {task.dependsOn!.join(", ")}</div></Show>
                          <Show when={state()?.error}><div class="text-10-regular text-icon-error mt-1 truncate">{errorText(state()!.error)}</div></Show>
                        </div>
                      )
                    }}
                  </For>
                </div>
              </section>

              <section>
                <div class="text-11-medium text-text-weak uppercase tracking-wide mb-2">Live Timeline</div>
                <div class="rounded-lg border border-border-weaker-base divide-y divide-border-weaker-base">
                  <For each={events().toReversed()}>
                    {(event) => (
                      <div class="px-3 py-2 flex items-start gap-2">
                        <span class="text-10-regular text-text-faint w-16 shrink-0">{eventTime(event)}</span>
                        <div class="min-w-0">
                          <div class="text-11-medium text-text-base">{labelForEvent[event.type] ?? event.type}</div>
                          <div class="text-10-regular text-text-weak truncate">
                            {event.data.taskID ?? event.data.reason ?? (event.data.key ? "Artifact " + event.data.key : "")}
                            <Show when={event.type === "session.next.cascade.task.retrying"}> · {errorText(event.data.error)}</Show>
                          </div>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </section>

              <Show when={artifacts().length}>
                <section>
                  <div class="text-11-medium text-text-weak uppercase tracking-wide mb-2">Artifacts</div>
                  <div class="flex flex-col gap-1">
                    <For each={artifacts()}>
                      {(artifact) => (
                        <div class="px-3 py-2 rounded-md bg-background-stronger border border-border-weaker-base flex items-center gap-2">
                          <Icon name="file" size="13" />
                          <span class="text-11-medium text-text-base truncate">{artifact.label ?? artifact.key}</span>
                          <span class="ms-auto text-10-regular text-text-faint">{artifact.kind ?? "result"}</span>
                        </div>
                      )}
                    </For>
                  </div>
                </section>
              </Show>

              <Show when={graph()?.tasks.length}>
                <section>
                  <div class="text-11-medium text-text-weak uppercase tracking-wide mb-2">Execution Isolation</div>
                  <div class="grid grid-cols-2 gap-2">
                    <For each={graph()!.tasks}>
                      {(node) => (
                        <div class="rounded-md border border-border-weaker-base px-2.5 py-2">
                          <div class="text-10-medium text-text-base">{node.metadata?.taskID ?? node.item.id}</div>
                          <div class="text-10-regular text-text-faint mt-1">{node.metadata?.git?.isolated ? "Git worktree" : "Shared workspace"}</div>
                          <Show when={node.metadata?.git?.branch}><div class="text-10-regular text-text-faint truncate">{node.metadata?.git?.branch}</div></Show>
                        </div>
                      )}
                    </For>
                  </div>
                </section>
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </Show>
  )
}
