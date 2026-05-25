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

Add this to ~/.codex/config.toml:

[mcp_servers.claude_bridge]
command = "node"
args = ["${target}"]
cwd = "."
startup_timeout_sec = 120

Restart Codex CLI or open a fresh Codex Desktop session after editing config.
EOF

