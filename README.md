# Claude Code MCP Bridge for Codex

Reusable MCP bridge that lets Codex CLI and Codex Desktop delegate bounded worker tasks to Claude Code.

Codex stays the orchestrator, reviewer, verifier, and final decision maker. Claude Code is only a bounded worker. This repo packages the bridge script, Codex config examples, install/check helpers, and troubleshooting notes in one place.

## What Is Included

- `scripts/claude-bridge-mcp.js` - MCP server exposing Claude Code worker tools.
- `scripts/install-global.sh` - installs the bridge script into `~/.codex/tools/`.
- `scripts/check-bridge.sh` - validates Node syntax and MCP `tools/list`.
- `config/codex-global.example.toml` - global Codex config snippet for CLI and Desktop.
- `config/codex-project.example.toml` - project-local config snippet for repos that keep `.codex/config.toml`.
- `skills/claude-code-mcp-bridge.md` - reusable operating workflow for Codex.
- `docs/troubleshooting.md` - layer-by-layer diagnostics, including Codex Desktop tool exposure mismatch.

## Quick Start

```bash
./scripts/check-bridge.sh
./scripts/install-global.sh
```

Then add the snippet from `config/codex-global.example.toml` to `~/.codex/config.toml`.

Restart Codex CLI or start a new Codex Desktop session after changing MCP config. Codex Desktop may show the server in the CLI registry while the active model session still does not expose `mcp__claude_bridge__*` tools until a fresh session loads the tool set.

## Exposed Tools

- `claude_health_check`
- `claude_start_task`
- `claude_get_status`
- `claude_read_events`
- `claude_get_result`
- `claude_stop_task`

Worker runs write inspectable artifacts under:

```text
.agent-runs/claude/<run_id>/
```

## Health Model

Diagnose in this order:

1. Codex Desktop session exposure: the active model tool set includes `mcp__claude_bridge__*` tools.
2. MCP bridge connectivity: manual JSON-RPC `initialize` and `tools/list` work.
3. Claude CLI availability: `claude --version` works in the bridge environment.
4. Claude API/network availability: a tiny Claude worker smoke test completes outside the Codex sandbox.

`MCP bridge unavailable` is still a correct exception when layer 1 fails, even if layers 2 and 3 are healthy.

## Remote Setup Later

When you have the remote URL:

```bash
git remote add origin <remote-url>
git push -u origin main
```

