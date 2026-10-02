import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { LayerNode } from "@vexis/core/effect/layer-node"
import { ProjectMemory } from "@vexis/core/project/memory"
import { AbsolutePath } from "@vexis/core/schema"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(ProjectMemory.node))

describe("Project memory", () => {
  it.live("serializes concurrent appends without losing entries", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (dir) =>
        Effect.gen(function* () {
          const memory = yield* ProjectMemory.Service
          const directory = AbsolutePath.make(path.join(dir.path, "workspace"))
          yield* Effect.promise(() => fs.mkdir(directory, { recursive: true }))

          yield* Effect.forEach(
            Array.from({ length: 20 }, (_, index) => index),
            (index) =>
              memory.append({
                directory,
                entry: {
                  topic: `Entry ${index}`,
                  content: `value-${index}`,
                  source: "test",
                },
              }),
            { concurrency: "unbounded", discard: true },
          )

          const value = yield* memory.read(directory)
          for (let index = 0; index < 20; index++) {
            expect(value).toContain(`## Entry ${index}`)
            expect(value).toContain(`value-${index}`)
          }
        }),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ),
  )
})
