#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { spawn, spawnSync } = require("child_process");

const root = process.cwd();
const runRoot = path.join(root, ".agent-runs", "claude");
const serverVersion = "0.3.0";
const apiEgressEnv = "CLAUDE_BRIDGE_ALLOW_API_EGRESS";
const contextFileMaxBytes = 512 * 1024;
const workerInstruction =
  "You are a worker, not the architect. Follow the task exactly. Do not redesign. Do not make broad changes. Do not invent test results. Return files inspected, files changed, commands run, outputs, diff summary, and unresolved issues.";

const active = new Map();
const destructivePatterns = [
  /\brm\s+-[^\n]*r/i,
  /\brm\s+-rf\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-f/i,
  /\bgit\s+push\s+--force\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\btruncate\s+-s\s+0\b/i,
  /\bdrop\s+database\b/i,
  /\bdelete\s+from\b/i,
  /\bchmod\s+-R\s+777\b/i,
  /\bchown\s+-R\b/i,
];

function now() {
  return new Date().toISOString();
}

function ensureDirs() {
  fs.mkdirSync(runRoot, { recursive: true });
}

function newRunID() {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  const suffix = Math.random().toString(16).slice(2, 8);
  return `${stamp}-${process.pid}-${suffix}`;
}

function dirFor(runID) {
  return path.join(runRoot, runID);
}

function fileFor(runID, name) {
  return path.join(dirFor(runID), name);
}

function writeJSON(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function statusPath(runID) {
  return fileFor(runID, "status.json");
}

function eventsPath(runID) {
  return fileFor(runID, "events.jsonl");
}

function resultPath(runID) {
  return fileFor(runID, "result.md");
}

function metaPath(runID) {
  return fileFor(runID, "meta.json");
}

function readStatus(runID) {
  return readJSON(statusPath(runID));
}

function writeStatus(runID, patch) {
  const file = statusPath(runID);
  const current = fs.existsSync(file) ? readJSON(file) : { run_id: runID };
  writeJSON(file, { ...current, ...patch });
}

function appendEvent(runID, event) {
  const status = readStatus(runID);
  const seq = Number(status.events_count || 0) + 1;
  const record = { seq, at: now(), ...event };
  fs.appendFileSync(eventsPath(runID), `${JSON.stringify(record)}\n`);
  writeStatus(runID, { events_count: seq, last_activity_at: record.at });
  return record;
}

function readEvents(runID, sinceSeq = 0, limit = 100) {
  const file = eventsPath(runID);
  if (!fs.existsSync(file)) return [];
  const from = Number(sinceSeq || 0);
  const max = Math.max(1, Math.min(Number(limit || 100), 500));
  const events = [];
  for (const line of fs.readFileSync(file, "utf8").split(/\n/)) {
    if (!line) continue;
    const event = JSON.parse(line);
    if (Number(event.seq) <= from) continue;
    events.push(event);
    if (events.length >= max) break;
  }
  return events;
}

function looksDestructive(prompt) {
  return destructivePatterns.some((pattern) => pattern.test(prompt || ""));
}

function envAllowsApiEgress() {
  return /^(1|true|yes)$/i.test(String(process.env[apiEgressEnv] || ""));
}

function apiEgressPolicy(workspaceEgressConsent = false) {
  const env_opt_in = envAllowsApiEgress();
  const task_consent = Boolean(workspaceEgressConsent);
  return {
    env_var: apiEgressEnv,
    env_opt_in,
    task_consent,
    allowed: env_opt_in && task_consent,
    reason: env_opt_in && task_consent ? "" : "workspace_api_egress_not_allowed",
  };
}

function fullPrompt(prompt, workspaceMode = "current_workspace", contextFiles = []) {
  const contextNote =
    workspaceMode === "context_bundle"
      ? [
          "Workspace mode: context_bundle.",
          "You are running inside an isolated context directory that contains only explicitly approved files.",
          "Do not assume other workspace files are available. Return patch guidance or edits only for files present in this context bundle.",
          `Approved context files: ${contextFiles.join(", ")}`,
        ].join("\n")
      : "Workspace mode: current_workspace.";
  return `${workerInstruction}\n\n${contextNote}\n\nTask:\n${prompt}`;
}

function normalizeContextFiles(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("context_files must be an array of relative file paths");
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function prepareContextBundle(runID, contextFiles) {
  if (contextFiles.length === 0) {
    throw new Error("context_bundle mode requires at least one context file");
  }

  const contextRoot = fileFor(runID, "context");
  const rootReal = fs.realpathSync(root);
  const copied = [];
  fs.mkdirSync(contextRoot, { recursive: true });

  for (const rel of contextFiles) {
    if (path.isAbsolute(rel)) throw new Error(`context file must be relative: ${rel}`);
    if (rel.split(/[\\/]+/).includes("..")) throw new Error(`context file cannot contain '..': ${rel}`);
    if (rel === ".agent-runs" || rel.startsWith(".agent-runs/")) {
      throw new Error(`context file cannot come from .agent-runs: ${rel}`);
    }

    const source = path.resolve(root, rel);
    const relativeFromRoot = path.relative(root, source);
    if (relativeFromRoot.startsWith("..") || path.isAbsolute(relativeFromRoot)) {
      throw new Error(`context file escapes workspace: ${rel}`);
    }
    if (!fs.existsSync(source)) throw new Error(`context file does not exist: ${rel}`);
    const realSource = fs.realpathSync(source);
    const realRelativeFromRoot = path.relative(rootReal, realSource);
    if (realRelativeFromRoot.startsWith("..") || path.isAbsolute(realRelativeFromRoot)) {
      throw new Error(`context file resolves outside workspace: ${rel}`);
    }

    const stat = fs.statSync(realSource);
    if (!stat.isFile()) throw new Error(`context path is not a file: ${rel}`);
    if (stat.size > contextFileMaxBytes) {
      throw new Error(`context file exceeds ${contextFileMaxBytes} byte limit: ${rel}`);
    }

    const dest = path.join(contextRoot, relativeFromRoot);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(realSource, dest);
    copied.push({
      path: relativeFromRoot,
      bytes: stat.size,
    });
  }

  writeJSON(fileFor(runID, "context-manifest.json"), {
    context_root: contextRoot,
    source_root: root,
    copied,
  });

  return { contextRoot, copied };
}

function renderResult(runID, status) {
  const output = readEvents(runID, 0, 2000)
    .filter((event) => event.type === "stdout" || event.type === "stderr")
    .map((event) => event.data)
    .join("\n");
  const tail = output.split(/\n/).slice(-120).join("\n");
  const meta = fs.existsSync(metaPath(runID)) ? readJSON(metaPath(runID)) : {};
  return [
    "# Claude Bridge Result",
    "",
    `- Run ID: \`${runID}\``,
    `- Status: ${status.state || "unknown"}`,
    `- Exit code: ${status.exit_code === null || status.exit_code === undefined ? "" : status.exit_code}`,
    `- Started: \`${status.started_at || ""}\``,
    `- Ended: \`${status.ended_at || ""}\``,
    `- Last activity: \`${status.last_activity_at || ""}\``,
    `- PID: ${status.pid || ""}`,
    `- Rejected: ${meta.rejected ? "yes" : "no"}`,
    "",
    "## Latest Events Tail",
    "",
    "```text",
    tail,
    "```",
    "",
  ].join("\n");
}

function finalize(runID, patch) {
  writeStatus(runID, patch);
  const status = readStatus(runID);
  fs.writeFileSync(resultPath(runID), renderResult(runID, status));
}

function requireRunID(args) {
  const runID = String(args.run_id || "").trim();
  if (!runID) throw new Error("run_id is required");
  if (!fs.existsSync(dirFor(runID))) throw new Error(`unknown run_id: ${runID}`);
  return runID;
}

function toolText(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }] };
}

function startTask(args) {
  const prompt = String(args.prompt || args.task || "").trim();
  const allowDestructive = Boolean(args.allow_destructive);
  const workspaceEgressConsent = Boolean(args.workspace_egress_consent);
  const workspaceMode = String(args.workspace_mode || "current_workspace").trim();
  const allowedWorkspaceModes = new Set(["current_workspace", "context_bundle"]);
  const contextFiles = normalizeContextFiles(args.context_files);
  const permissionMode = String(args.permission_mode || "default").trim();
  const allowedPermissionModes = new Set(["acceptEdits", "auto", "bypassPermissions", "default", "dontAsk", "plan"]);
  if (!prompt) throw new Error("prompt is required");
  if (!allowedWorkspaceModes.has(workspaceMode)) {
    throw new Error(`unsupported workspace_mode: ${workspaceMode}`);
  }
  if (!allowedPermissionModes.has(permissionMode)) {
    throw new Error(`unsupported permission_mode: ${permissionMode}`);
  }

  ensureDirs();
  const runID = newRunID();
  const dir = dirFor(runID);
  fs.mkdirSync(dir, { recursive: true });

  const startedAt = now();
  const meta = {
    run_id: runID,
    cwd: root,
    created_at: startedAt,
    worker_instruction: workerInstruction,
    allow_destructive: allowDestructive,
    workspace_egress_policy: apiEgressPolicy(workspaceEgressConsent),
    workspace_mode: workspaceMode,
    context_files: contextFiles,
    permission_mode: permissionMode,
    rejected: false,
    command: [
      "claude",
      "-p",
      "<wrapped prompt>",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--permission-mode",
      permissionMode,
    ],
  };
  writeJSON(metaPath(runID), meta);
  writeJSON(statusPath(runID), {
    run_id: runID,
    state: "starting",
    pid: null,
    started_at: startedAt,
    last_activity_at: startedAt,
    ended_at: null,
    exit_code: null,
    signal: null,
    events_count: 0,
    error: null,
  });
  fs.writeFileSync(eventsPath(runID), "");
  fs.writeFileSync(resultPath(runID), "# Claude Bridge Result\n\nResult is pending.\n");

  const egress = apiEgressPolicy(workspaceEgressConsent);
  if (!egress.allowed) {
    writeJSON(metaPath(runID), {
      ...meta,
      workspace_egress_policy: egress,
      rejected: true,
      reject_reason: egress.reason,
    });
    appendEvent(runID, {
      type: "rejected",
      data: `Task rejected because workspace API egress is not allowed. Set ${apiEgressEnv}=1 and pass workspace_egress_consent=true only after explicit approval.`,
    });
    finalize(runID, {
      state: "rejected",
      ended_at: now(),
      exit_code: 65,
      error: egress.reason,
    });
    return toolText(pathsFor(runID, { state: "rejected" }));
  }

  if (looksDestructive(prompt) && !allowDestructive) {
    writeJSON(metaPath(runID), {
      ...meta,
      rejected: true,
      reject_reason: "destructive_task_requires_allow_destructive",
    });
    appendEvent(runID, {
      type: "rejected",
      data: "Task rejected because it appears destructive. Pass allow_destructive=true only after explicit user approval.",
    });
    finalize(runID, {
      state: "rejected",
      ended_at: now(),
      exit_code: 64,
      error: "destructive_task_requires_allow_destructive",
    });
    return toolText(pathsFor(runID, { state: "rejected" }));
  }

  const context =
    workspaceMode === "context_bundle"
      ? prepareContextBundle(runID, contextFiles)
      : { contextRoot: root, copied: [] };
  writeJSON(metaPath(runID), {
    ...readJSON(metaPath(runID)),
    execution_cwd: context.contextRoot,
    context_bundle: workspaceMode === "context_bundle" ? context : null,
  });

  const child = spawn(
    "claude",
    [
      "-p",
      fullPrompt(prompt, workspaceMode, contextFiles),
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--permission-mode",
      permissionMode,
    ],
    { cwd: context.contextRoot, stdio: ["ignore", "pipe", "pipe"] },
  );

  active.set(runID, child);
  writeStatus(runID, { state: "running", pid: child.pid });
  appendEvent(runID, { type: "system", data: `started claude pid=${child.pid}` });

  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    appendEvent(runID, { type: "stdout", data: line });
  });
  readline.createInterface({ input: child.stderr }).on("line", (line) => {
    appendEvent(runID, { type: "stderr", data: line });
  });

  child.on("error", (error) => {
    appendEvent(runID, { type: "error", data: error.message });
    finalize(runID, { state: "failed", ended_at: now(), exit_code: 127, error: error.message });
    active.delete(runID);
  });

  child.on("close", (code, signal) => {
    const exitCode = code === null ? 128 : code;
    appendEvent(runID, { type: "system", data: `claude exited code=${exitCode} signal=${signal || ""}` });
    finalize(runID, {
      state: exitCode === 0 ? "completed" : "failed",
      ended_at: now(),
      exit_code: exitCode,
      signal: signal || null,
    });
    active.delete(runID);
  });

  return toolText(pathsFor(runID, { state: "running", pid: child.pid }));
}

function prepareContextBundleTask(args) {
  const contextFiles = normalizeContextFiles(args.context_files);
  ensureDirs();
  const runID = newRunID();
  const dir = dirFor(runID);
  fs.mkdirSync(dir, { recursive: true });

  const startedAt = now();
  writeJSON(statusPath(runID), {
    run_id: runID,
    state: "prepared",
    pid: null,
    started_at: startedAt,
    last_activity_at: startedAt,
    ended_at: startedAt,
    exit_code: 0,
    signal: null,
    events_count: 0,
    error: null,
  });
  fs.writeFileSync(eventsPath(runID), "");
  fs.writeFileSync(resultPath(runID), "# Claude Context Bundle\n\nContext bundle prepared locally. No Claude API call was made.\n");

  const context = prepareContextBundle(runID, contextFiles);
  writeJSON(metaPath(runID), {
    run_id: runID,
    cwd: root,
    created_at: startedAt,
    workspace_mode: "context_bundle",
    context_files: contextFiles,
    execution_cwd: context.contextRoot,
    context_bundle: context,
    api_called: false,
    rejected: false,
  });
  appendEvent(runID, {
    type: "system",
    data: `prepared context bundle with ${context.copied.length} file(s); no Claude API call was made`,
  });
  finalize(runID, { state: "prepared", ended_at: now(), exit_code: 0 });
  return toolText(pathsFor(runID, { state: "prepared", context_path: context.contextRoot }));
}

function pathsFor(runID, extra = {}) {
  return {
    run_id: runID,
    ...extra,
    status_path: statusPath(runID),
    events_path: eventsPath(runID),
    result_path: resultPath(runID),
    meta_path: metaPath(runID),
  };
}

function stopTask(args) {
  const runID = requireRunID(args);
  const child = active.get(runID);
  if (!child) {
    const status = readStatus(runID);
    return toolText({ run_id: runID, stopped: false, state: status.state, reason: "process_not_owned_by_current_bridge" });
  }
  writeStatus(runID, { state: "stopping", last_activity_at: now() });
  appendEvent(runID, { type: "system", data: "stop requested by Codex" });
  child.kill("SIGTERM");
  setTimeout(() => {
    if (active.has(runID)) child.kill("SIGKILL");
  }, 5000).unref();
  return toolText({ run_id: runID, stopped: true, signal: "SIGTERM" });
}

function healthCheck(args) {
  const apiSmoke = Boolean(args && args.api_smoke);
  const health = {
    bridge: {
      ok: true,
      server: "claude-bridge",
      version: serverVersion,
      tools: tools.map((tool) => tool.name),
      desktop_session_exposure_hint:
        "If codex mcp list and manual tools/list see this server but the active Codex Desktop model tool set has no mcp__claude_bridge__* tools, diagnose MCP bridge unavailable as a Desktop session/tool-exposure mismatch.",
    },
    claude_cli: {
      ok: false,
      command: "claude --version",
      version: "",
      error: "",
    },
    claude_api: {
      ok: false,
      checked: apiSmoke,
      requires_outside_sandbox: true,
      workspace_egress_policy: apiEgressPolicy(Boolean(args && args.workspace_egress_consent)),
      command: "claude -p 'Return exactly: bridge api ok'",
      status: apiSmoke ? "checking" : "not_run",
      error: "",
      sandbox_blocking_hint:
        "In this project, API Error: Unable to connect to API (ConnectionRefused) usually means the bridge or Claude Code was launched inside the Codex sandbox.",
    },
  };

  const cli = spawnSync("claude", ["--version"], { cwd: root, encoding: "utf8", timeout: 5000 });
  health.claude_cli.ok = cli.status === 0;
  health.claude_cli.version = String(cli.stdout || "").trim();
  health.claude_cli.error = String(cli.stderr || cli.error || "").trim();

  if (!apiSmoke) {
    health.claude_api.status = "not_run_outside_sandbox_smoke_required";
    return toolText(health);
  }

  if (!health.claude_api.workspace_egress_policy.allowed) {
    health.claude_api.status = "blocked_by_workspace_egress_policy";
    health.claude_api.error = "workspace_api_egress_not_allowed";
    return toolText(health);
  }

  const api = spawnSync("claude", ["-p", "Return exactly: bridge api ok"], {
    cwd: root,
    encoding: "utf8",
    timeout: 30000,
  });
  const output = `${api.stdout || ""}\n${api.stderr || ""}`.trim();
  health.claude_api.ok = api.status === 0 && output.includes("bridge api ok");
  health.claude_api.status = api.error ? "error" : api.status === 0 ? "completed" : "failed";
  health.claude_api.exit_code = api.status;
  health.claude_api.output_tail = output.split(/\n/).slice(-20).join("\n");
  if (api.error) {
    health.claude_api.error = api.error.message;
  } else if (/ConnectionRefused|Unable to connect to API/i.test(output)) {
    health.claude_api.error = "sandbox_or_network_blocked_claude_api";
  }
  return toolText(health);
}

function callTool(name, args) {
  switch (name) {
    case "claude_health_check":
      return healthCheck(args || {});
    case "claude_start_task":
      return startTask(args || {});
    case "claude_prepare_context_bundle":
      return prepareContextBundleTask(args || {});
    case "claude_get_status": {
      const runID = requireRunID(args || {});
      return toolText(readStatus(runID));
    }
    case "claude_read_events": {
      const runID = requireRunID(args || {});
      return toolText({ run_id: runID, events: readEvents(runID, args.since_seq || 0, args.limit || 100) });
    }
    case "claude_get_result": {
      const runID = requireRunID(args || {});
      return toolText(fs.readFileSync(resultPath(runID), "utf8"));
    }
    case "claude_stop_task":
      return stopTask(args || {});
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

const tools = [
  {
    name: "claude_health_check",
    description:
      "Report MCP bridge health, Claude CLI availability, and optionally run a Claude API smoke test. API smoke must be run outside the Codex sandbox.",
    inputSchema: {
      type: "object",
      properties: {
        api_smoke: { type: "boolean", default: false },
        workspace_egress_consent: { type: "boolean", default: false },
      },
    },
  },
  {
    name: "claude_start_task",
    description: "Start a bounded Claude Code worker task in the background and return run_id immediately.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        allow_destructive: { type: "boolean", default: false },
        workspace_egress_consent: { type: "boolean", default: false },
        workspace_mode: {
          type: "string",
          enum: ["current_workspace", "context_bundle"],
          default: "current_workspace",
        },
        context_files: {
          type: "array",
          items: { type: "string" },
          default: [],
        },
        permission_mode: {
          type: "string",
          enum: ["acceptEdits", "auto", "bypassPermissions", "default", "dontAsk", "plan"],
          default: "default",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "claude_prepare_context_bundle",
    description:
      "Prepare an isolated local context bundle from explicit relative files without calling the Claude API.",
    inputSchema: {
      type: "object",
      properties: {
        context_files: {
          type: "array",
          items: { type: "string" },
          default: [],
        },
      },
      required: ["context_files"],
    },
  },
  {
    name: "claude_get_status",
    description: "Read status.json for a Claude worker run.",
    inputSchema: { type: "object", properties: { run_id: { type: "string" } }, required: ["run_id"] },
  },
  {
    name: "claude_read_events",
    description: "Read incremental events from events.jsonl by sequence number.",
    inputSchema: {
      type: "object",
      properties: {
        run_id: { type: "string" },
        since_seq: { type: "number", default: 0 },
        limit: { type: "number", default: 100 },
      },
      required: ["run_id"],
    },
  },
  {
    name: "claude_get_result",
    description: "Read result.md for a Claude worker run.",
    inputSchema: { type: "object", properties: { run_id: { type: "string" } }, required: ["run_id"] },
  },
  {
    name: "claude_stop_task",
    description: "Stop a running Claude worker task owned by this bridge process.",
    inputSchema: { type: "object", properties: { run_id: { type: "string" } }, required: ["run_id"] },
  },
];

let transportMode = null;

function send(message) {
  const body = JSON.stringify(message);
  if (transportMode === "content-length") {
    process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
  } else {
    process.stdout.write(`${body}\n`);
  }
}

function handle(message) {
  const { id, method, params } = message;
  try {
    if (method === "initialize") {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "claude-bridge", version: serverVersion },
        },
      });
    } else if (method === "notifications/initialized") {
      return;
    } else if (method === "tools/list") {
      send({ jsonrpc: "2.0", id, result: { tools } });
    } else if (method === "tools/call") {
      send({ jsonrpc: "2.0", id, result: callTool(params.name, params.arguments || {}) });
    } else {
      send({ jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } });
    }
  } catch (error) {
    send({ jsonrpc: "2.0", id, error: { code: -32000, message: error.message } });
  }
}

function handleParseError(error) {
  send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: error.message } });
}

function startLineDelimitedInput() {
  readline.createInterface({ input: process.stdin }).on("line", (line) => {
    if (!line.trim()) return;
    transportMode = transportMode || "line";
    try {
      handle(JSON.parse(line));
    } catch (error) {
      handleParseError(error);
    }
  });
}

function startContentLengthInput(initialChunk) {
  let buffer = Buffer.alloc(0);

  function consume() {
    while (buffer.length > 0) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;

      const header = buffer.slice(0, headerEnd).toString("utf8");
      const match = /(?:^|\r\n)Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        handleParseError(new Error("missing Content-Length header"));
        buffer = Buffer.alloc(0);
        return;
      }

      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + length;
      if (buffer.length < bodyEnd) return;

      const body = buffer.slice(bodyStart, bodyEnd).toString("utf8");
      buffer = buffer.slice(bodyEnd);
      try {
        handle(JSON.parse(body));
      } catch (error) {
        handleParseError(error);
      }
    }
  }

  if (initialChunk && initialChunk.length) {
    buffer = Buffer.concat([buffer, initialChunk]);
    consume();
  }

  process.stdin.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    consume();
  });
}

function startInput() {
  let started = false;
  process.stdin.once("data", (chunk) => {
    started = true;
    const text = chunk.toString("utf8", 0, Math.min(chunk.length, 32));
    if (text.startsWith("Content-Length:")) {
      transportMode = "content-length";
      startContentLengthInput(chunk);
    } else {
      transportMode = "line";
      process.stdin.unshift(chunk);
      startLineDelimitedInput();
    }
  });

  process.stdin.once("end", () => {
    if (!started) process.exit(0);
  });
}

ensureDirs();
startInput();
