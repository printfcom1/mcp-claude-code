#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target_dir="${HOME}/.codex/tools"
target="${target_dir}/claude-bridge-mcp.js"

mkdir -p "${target_dir}"
cp "${repo_root}/scripts/claude-bridge-mcp.js" "${target}"
chmod +x "${target}"

cat <<EOF
Installed:
  ${target}

Source of truth:
  ${repo_root}

Update workflow:
  1. Update this repository.
  2. Run: npm run check
  3. Run: npm run install:global

Add this to ~/.codex/config.toml:

[mcp_servers.claude_bridge]
command = "node"
args = ["${target}"]
# Codex CLI can usually use cwd = ".".
# If Codex Desktop lists claude_bridge but does not expose
# mcp__claude_bridge__* tools in a fresh session, replace this with an
# absolute workspace path.
cwd = "/absolute/path/to/your/codex/workspace"
startup_timeout_sec = 120

Restart Codex CLI or open a fresh Codex Desktop session after editing config.
EOF
