# Operation Workflow

Use Claude Code only as a bounded worker. Codex remains responsible for architecture, acceptance criteria, review, and verification.

## Source of Truth

Update `scripts/claude-bridge-mcp.js` in this repository first. Do not manually patch `~/.codex/tools/claude-bridge-mcp.js`; install the reviewed repo version with:

```bash
npm run check
npm run install:global
```

Restart Codex CLI or Codex Desktop after installing so MCP tool schemas refresh.

## Workspace API Egress

The bridge fails closed before spawning Claude Code. Real Claude API execution requires both:

```bash
CLAUDE_BRIDGE_ALLOW_API_EGRESS=1
```

and per-task consent:

```json
{ "workspace_egress_consent": true }
```

If either condition is missing, `claude_start_task` records run artifacts and rejects with `workspace_api_egress_not_allowed`.

## Worker Prompt Shape

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

1. Read status/events/result/meta artifacts under `.agent-runs/claude/<run_id>/`.
2. Inspect the diff yourself.
3. Run the repo's verification command.
4. Accept, fix, or reject the output.
5. Record delegation scope, result, verification, and risks when the project has a history workflow.
