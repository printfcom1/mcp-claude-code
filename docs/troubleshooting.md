# Troubleshooting

## Layer 1: Codex Desktop Session Exposure

Symptom:

```text
MCP bridge unavailable
```

This can be correct even when the MCP registry sees the server. The active Codex Desktop model tool set must expose tools named like:

```text
mcp__claude_bridge__claude_start_task
```

If `codex mcp list --json` sees `claude_bridge`, and a manual JSON-RPC `tools/list` returns the bridge tools, but the active session has no `mcp__claude_bridge__*` tools, diagnose a Codex Desktop session/tool-exposure mismatch. Do not blame Claude CLI, Claude API/network, or bridge script crash.

Fix:

- Open a fresh Codex Desktop session after editing `~/.codex/config.toml`.
- Confirm the Desktop session's available tools include `mcp__claude_bridge__*`.
- Keep `MCP bridge unavailable` as the right exception when the active session cannot call the tools.

## Layer 2: MCP Bridge Connectivity

Run:

```bash
./scripts/check-bridge.sh
```

Expected:

- `node --check scripts/claude-bridge-mcp.js` passes.
- MCP `tools/list` includes `claude_health_check`, `claude_start_task`, `claude_get_status`, `claude_read_events`, `claude_get_result`, and `claude_stop_task`.

## Layer 3: Claude CLI Availability

Run:

```bash
claude --version
```

If this fails, install or repair Claude Code before testing API/network behavior.

## Layer 4: Claude API/Network Availability

Real worker execution requires Claude API network access. In sandboxed Codex environments this can fail even when the bridge and CLI are healthy:

```text
API Error: Unable to connect to API (ConnectionRefused)
```

Run API smoke tests outside the Codex sandbox before treating this as a bridge or prompt failure.

