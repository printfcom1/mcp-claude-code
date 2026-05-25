# MCP Claude Code Bridge for Codex

A reusable Model Context Protocol (MCP) bridge that enables Codex CLI and Codex Desktop to delegate bounded worker tasks to Claude Code.

This project packages a standalone MCP server, Codex configuration examples, installation helpers, verification scripts, and operating guidance for teams that want a repeatable Claude Code worker integration across local repositories.

## Purpose

The bridge is designed for workflows where Codex remains the orchestrator and Claude Code acts as a scoped implementation worker.

Codex is responsible for:

- understanding the task and project context;
- defining acceptance criteria and allowed write scope;
- deciding what can safely be delegated;
- reviewing all Claude Code output and diffs;
- running independent verification before accepting changes.

Claude Code is responsible only for the bounded task it is given.

## Repository Contents

| Path | Description |
| --- | --- |
| `scripts/claude-bridge-mcp.js` | MCP server that exposes Claude Code worker tools. |
| `scripts/install-global.sh` | Installs the bridge into `~/.codex/tools/`. |
| `scripts/check-bridge.sh` | Validates JavaScript syntax and MCP `tools/list`. |
| `config/codex-global.example.toml` | Global Codex MCP config example for `~/.codex/config.toml`. |
| `config/codex-project.example.toml` | Optional project-local Codex config example. |
| `docs/operation.md` | Recommended delegation and review workflow. |
| `docs/troubleshooting.md` | Layer-by-layer diagnostics for CLI, Desktop, bridge, and API issues. |
| `skills/claude-code-mcp-bridge.md` | Reusable Codex skill guidance for operating the bridge. |

## Requirements

- Node.js available on `PATH`.
- Claude Code CLI installed and available as `claude`.
- Codex CLI or Codex Desktop with MCP server support.
- Claude API/network access for real worker execution.

The bridge and `claude --version` can succeed while real worker execution still fails if the process runs inside a network-restricted sandbox.

By default, the bridge also blocks workspace API egress before spawning Claude Code. Real Claude API execution requires both `CLAUDE_BRIDGE_ALLOW_API_EGRESS=1` in the bridge environment and `workspace_egress_consent: true` on the tool call.

For safer delegation, use `workspace_mode: "context_bundle"` with explicit `context_files`. The bridge copies only those approved files into `.agent-runs/claude/<run_id>/context/` and runs Claude from that isolated directory instead of the full workspace.

## Installation

Clone the repository:

```bash
git clone git@github.com:printfcom1/mcp-claude-code.git
cd mcp-claude-code
```

Run the local bridge check:

```bash
npm run check
```

Install the bridge globally for Codex:

```bash
npm run install:global
```

Add the MCP server entry to `~/.codex/config.toml`:

```toml
[mcp_servers.claude_bridge]
command = "node"
args = ["/Users/YOUR_USER/.codex/tools/claude-bridge-mcp.js"]
cwd = "."
startup_timeout_sec = 120
```

Replace `/Users/YOUR_USER` with your local home directory. The generated output from `scripts/install-global.sh` prints the exact path for your machine.

After updating Codex configuration, restart Codex CLI or open a fresh Codex Desktop session.

## Exposed MCP Tools

The bridge exposes these tools:

- `claude_health_check`
- `claude_start_task`
- `claude_prepare_context_bundle`
- `claude_get_status`
- `claude_read_events`
- `claude_get_result`
- `claude_stop_task`

Worker artifacts are written to the current workspace:

```text
.agent-runs/claude/<run_id>/
```

Each run directory contains status, event, result, and metadata files so Codex can inspect Claude Code output before accepting it.

`claude_prepare_context_bundle` prepares a local bundle from explicit relative files without calling the Claude API.

`claude_start_task` accepts `workspace_egress_consent`, `workspace_mode`, and `context_files`. If consent is omitted, or if `CLAUDE_BRIDGE_ALLOW_API_EGRESS=1` is not set, the run is rejected with `workspace_api_egress_not_allowed` and Claude is not spawned.

Example context-bundle delegation:

```json
{
  "prompt": "Inspect the selected files and propose the smallest patch.",
  "workspace_mode": "context_bundle",
  "context_files": ["README.md", "scripts/claude-bridge-mcp.js"],
  "workspace_egress_consent": true
}
```

## Health Checks

Diagnose bridge issues in this order:

1. **Codex Desktop session exposure**: the active model tool set includes `mcp__claude_bridge__*` tools.
2. **MCP bridge connectivity**: JSON-RPC `initialize` and `tools/list` return the expected tools.
3. **Claude CLI availability**: `claude --version` works in the bridge environment.
4. **Claude API/network availability**: a tiny Claude worker smoke test completes in the environment that will run workers.

`MCP bridge unavailable` is a valid failure when the active Codex Desktop session does not expose the bridge tools, even if the CLI registry and manual MCP checks can see the server.

## Codex CLI and Codex Desktop Notes

Codex CLI and Codex Desktop can both read MCP server configuration, but they may not expose tools to an already-running model session at the same time.

If `codex mcp list --json` shows `claude_bridge` and manual `tools/list` works, but Codex Desktop does not show callable `mcp__claude_bridge__*` tools, treat it as a Desktop session/tool-exposure mismatch. Start a fresh Desktop session after changing MCP configuration.

Do not diagnose that state as:

- Claude Code CLI failure;
- Claude API/network failure;
- bridge script crash.

## Worker Safety Model

Use narrow prompts and explicit scope. Claude Code should not be delegated architecture, security-sensitive decisions, production risk changes, secrets, billing/auth decisions, or final review.

Recommended worker prompt shape:

```text
You are a worker, not the architect. Follow the task exactly.
Do not redesign. Do not make broad changes. Do not invent test results.

Task:
<bounded task>

Allowed write scope:
<files or directories>

Non-goals:
<explicit exclusions>

Verification:
<commands expected>
```

Codex must review the diff and run verification before accepting any worker output.

## Verification

Run:

```bash
npm run check
```

This validates:

- JavaScript syntax for the MCP bridge;
- JSON-RPC initialization;
- MCP `tools/list`;
- presence of all expected Claude bridge tools;
- presence of the workspace egress consent and context-bundle schemas;
- local context bundle preparation without an API call;
- default rejection before spawning Claude when workspace egress is not explicitly allowed.

## License

This repository is currently marked `UNLICENSED` in `package.json`. Add a license before public distribution if the repository is intended for external reuse.
