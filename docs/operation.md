# Operation Workflow

Use Claude Code only as a bounded worker. Codex remains responsible for architecture, acceptance criteria, review, and verification.

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

