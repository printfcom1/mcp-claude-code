---
name: claude-code-mcp-bridge
description: Use when setting up, validating, documenting, troubleshooting, or operating the global Claude Code MCP bridge that lets Codex delegate bounded worker tasks to Claude Code across any local repository. Covers global Codex MCP registration, per-workspace run artifacts, bridge/CLI/API health checks, outside-sandbox execution, ConnectionRefused diagnosis, scoped worker prompts, and Codex-as-orchestrator review rules.
metadata:
  short-description: Global Claude Code MCP bridge setup and delegation workflow
---

# Claude Code MCP Bridge

Use this skill when Codex should delegate bounded work to Claude Code through the global MCP bridge.

## Global Setup

The global bridge is registered in `~/.codex/config.toml`:

```toml
[mcp_servers.claude_bridge]
command = "node"
args = ["/Users/ipassion_1/.codex/tools/claude-bridge-mcp.js"]
cwd = "."
startup_timeout_sec = 120
```

The bridge script lives at `~/.codex/tools/claude-bridge-mcp.js`. With `cwd = "."`, each Codex workspace should run Claude from that workspace and write artifacts under `.agent-runs/claude/<run_id>/`.

The repository is the source of truth. Update and verify the repo first, then install the global bridge with `npm run install:global`; do not manually patch `~/.codex/tools/claude-bridge-mcp.js`.

If tools are not visible in the current session, restart the Codex session after changing MCP config.

## Role Rule

Codex remains the orchestrator, architect, reviewer, verifier, and final decision maker. Claude Code is only a bounded worker. Never accept Claude output blindly.

Good worker tasks:

- searching and inspecting code
- small scoped patches
- mechanical refactors
- focused tests
- summarizing local command output
- larger implementation work only when Codex splits it into small, bounded, independently reviewable slices

Do not delegate architecture, security-sensitive decisions, destructive operations, production risk changes, secrets, billing/auth decisions, or final review.

## Operating Workflow

1. Search/read enough local context for Codex to define the slice.
2. Define objective, allowed write scope, non-goals, and verification.
3. Confirm workspace API egress is explicitly allowed before any real Claude API call.
4. Start Claude through `claude_start_task`; do not call `claude -p` directly in normal workflows.
5. Pass `workspace_egress_consent=true` only after explicit approval and only when `CLAUDE_BRIDGE_ALLOW_API_EGRESS=1` is set in the bridge environment.
6. Poll with `claude_get_status` and `claude_read_events`.
7. Read `claude_get_result` and inspect `.agent-runs/claude/<run_id>/` artifacts.
8. Review the diff yourself and run the repo's verification command.
9. Accept, fix, or reject the output; record delegation details if the repo has a history workflow.

## Health Checks

Diagnose in this order:

1. Codex Desktop session exposure: the active model tool set includes the bridge tools, such as `mcp__claude_bridge__claude_start_task`.
2. MCP bridge connectivity: server initializes and `tools/list` exposes the Claude tools.
3. Claude CLI availability: `claude --version` works in the bridge environment.
4. Claude API/network availability: a tiny worker smoke test completes with `exit_code: 0` in the same environment that will run workers.

If `codex mcp list --json` and a manual JSON-RPC `tools/list` see `claude_bridge`, but the active Codex Desktop model tool set has no `mcp__claude_bridge__*` tools, diagnose `MCP bridge unavailable` as a Desktop session/tool-exposure mismatch. Do not treat that as a Claude CLI failure, Claude API/network failure, or bridge script crash.

Real Claude Code worker execution requires network access to the Claude API. In sandboxed Codex environments, this error usually means sandbox/network blocking after bridge and CLI checks pass:

```text
API Error: Unable to connect to API (ConnectionRefused)
```

Do not claim API access works until a real API smoke test has passed.

The bridge fails closed for workspace API egress. Without `CLAUDE_BRIDGE_ALLOW_API_EGRESS=1` and per-call `workspace_egress_consent=true`, API smoke checks are reported as `blocked_by_workspace_egress_policy`, and worker tasks are rejected with `workspace_api_egress_not_allowed` before spawning Claude.

Prefer `workspace_mode="context_bundle"` for real delegation. Use `claude_prepare_context_bundle` to prepare explicit relative files locally first, then call `claude_start_task` with the same `context_files`, `workspace_mode="context_bundle"`, and explicit egress consent only after approval. Claude runs from the generated context directory, not the original workspace.

## Worker Prompt Shape

Use narrow prompts:

```text
You are a worker, not the architect. Follow the task exactly.
Do not redesign. Do not make broad changes. Do not invent test results.
Return only:
1. files inspected
2. files changed
3. commands run
4. command outputs or test results
5. patch/diff summary
6. unresolved issues

Task:
<bounded task>

Allowed write scope:
<files or directories>

Non-goals:
<explicit exclusions>

Verification:
<commands expected>
```

## Review Gate

After a worker finishes:

- Read status/events/result/meta artifacts.
- Inspect the diff yourself.
- Verify touched tests or the repo check command.
- Reject or fix output that exceeds scope, changes policy, invents results, or alters unrelated files.
- Record the delegation scope, result, verification, and risks when the repo has a history/log workflow.
