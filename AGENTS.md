# AGENTS.md

## Purpose

This repository packages the Claude Code MCP bridge for Codex CLI and Codex Desktop.

## Rules

- Codex is the orchestrator, reviewer, verifier, and final decision maker.
- Claude Code is only a bounded worker.
- Do not store API keys, secrets, tokens, or account-specific credentials in this repo.
- Keep config examples generic except for the intended local install path.
- Treat this repository as the source of truth for the global Claude bridge. Do not patch `~/.codex/tools/claude-bridge-mcp.js` directly except through `scripts/install-global.sh` after updating and verifying this repo first.
- The bridge must fail closed for workspace API egress. Real Claude API execution requires both `CLAUDE_BRIDGE_ALLOW_API_EGRESS=1` in the bridge environment and per-task `workspace_egress_consent=true`.
- Preserve the four-layer diagnostic model:
  1. Codex Desktop session tool exposure.
  2. MCP bridge connectivity.
  3. Claude CLI availability.
  4. Claude API/network availability.
