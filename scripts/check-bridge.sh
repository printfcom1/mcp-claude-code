#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bridge="${repo_root}/scripts/claude-bridge-mcp.js"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

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

if ! grep -q '"workspace_egress_consent"' <<<"${response}"; then
  echo "missing workspace_egress_consent schema" >&2
  exit 1
fi

health_response="$(
  cd "${tmp_dir}"
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"claude_health_check","arguments":{"api_smoke":true}}}' \
  | node "${bridge}"
)"

echo "${health_response}"

if ! grep -q 'workspace_api_egress_not_allowed' <<<"${health_response}"; then
  echo "workspace egress policy did not block API smoke by default" >&2
  exit 1
fi

policy_response="$(
  cd "${tmp_dir}"
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"claude_start_task","arguments":{"prompt":"Return without reading workspace files."}}}' \
  | node "${bridge}"
)"

echo "${policy_response}"

if ! grep -q 'rejected' <<<"${policy_response}"; then
  echo "workspace egress policy did not reject a task by default" >&2
  exit 1
fi

if grep -q 'running' <<<"${policy_response}"; then
  echo "workspace egress policy unexpectedly started Claude" >&2
  exit 1
fi

echo "Bridge syntax, tools/list, schema, and default policy checks passed."
