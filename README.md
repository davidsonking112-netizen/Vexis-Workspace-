<p align="center">
  <h1 align="center">Vexis Workspace</h1>
</p>
<p align="center">An open-source AI development workspace built for agentic software engineering.</p>

<p align="center">
  <a href="https://github.com/davidsonking112-netizen/Vexis-Workspace-/actions"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/davidsonking112-netizen/Vexis-Workspace-/publish.yml?style=flat-square&branch=dev" /></a>
  <a href="https://github.com/davidsonking112-netizen/Vexis-Workspace-/commits/dev"><img alt="Commits" src="https://img.shields.io/github/commit-activity/m/davidsonking112-netizen/Vexis-Workspace-?style=flat-square" /></a>
</p>

---

## What is Vexis Workspace?

Vexis Workspace is an AI-powered development environment for working with autonomous coding agents, projects, sessions, tools, and model providers.

The repository currently uses the OpenCode runtime architecture as its underlying foundation while Vexis-specific product identity and capabilities are being developed on top of it.

### Development

```bash
bun install
bun run dev
```

For the web application:

```bash
bun run dev:web
```

For the desktop application:

```bash
bun run dev:desktop
```

### CLI

The Vexis command is:

```bash
vexis --help
```

From the repository during development:

```bash
bun run --cwd packages/vexis src/index.ts --help
```

### Architecture

Vexis Workspace is a TypeScript/Bun monorepo with separate layers for:

- agent execution and sessions
- protocol, schema, and SDK boundaries
- server and client APIs
- terminal UI and web UI
- desktop integration
- model/provider integrations
- plugins and external tools

### Project direction

Vexis is being developed as a distinct product rather than a cosmetic rename. The current priority is to preserve the proven execution architecture while adding Vexis-specific workspace, agent, automation, policy, and product capabilities.

### Upstream

Vexis Workspace is derived from the OpenCode project. Upstream architecture and dependencies are retained where useful while Vexis-specific development proceeds in this repository.

## Contributing

Contributions should preserve the reliability of the agent execution and session layers while keeping Vexis-specific functionality modular and maintainable.

## License

MIT
