#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bridge="${repo_root}/scripts/claude-bridge-mcp.js"

node --check "${bridge}"

response="$(
  printf '%s\n%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
    '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | node "${bridge}"
)"

echo "${response}"

for tool in \
  claude_health_check \
  claude_start_task \
  claude_get_status \
  claude_read_events \
  claude_get_result \
  claude_stop_task
do
  if ! grep -q "\"name\":\"${tool}\"" <<<"${response}" && ! grep -q "\"name\": \"${tool}\"" <<<"${response}"; then
    echo "missing tool: ${tool}" >&2
    exit 1
  fi
done

echo "Bridge syntax and tools/list check passed."

