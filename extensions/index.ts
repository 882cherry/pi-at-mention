import type {
  ExtensionAPI,
  AutocompleteProviderFactory,
} from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PACKAGE_NAME = "pi-at-mention";
const STATE_DIR = path.join(os.homedir(), ".pi", "agent", "extensions", PACKAGE_NAME);
const STATE_FILE = path.join(STATE_DIR, "state.json");
const AGENT_TARGET_DIR = path.join(os.homedir(), ".pi", "agent", "agents");
const SETTINGS_FILE = path.join(os.homedir(), ".pi", "agent", "settings.json");
const ORCHESTRATOR_MARKER = "## Your Role: Workflow Orchestrator";
const CURRENT_VERSION = "0.1.2";

// agents/ directory relative to this extension file
const AGENT_SRC_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "agents",
);

interface AgentInfo {
  name: string;
  description: string;
}

interface SetupState {
  version: string;
  setupCompleted: boolean;
  agentFiles: string[];
  disableBuiltinsSet: boolean;
}

// ---------------------------------------------------------------------------
// Simple frontmatter parser (compatible with pi-subagents agent format)
// ---------------------------------------------------------------------------

function parseFrontmatter(
  content: string,
): { frontmatter: Record<string, string>; body: string } {
  const frontmatter: Record<string, string> = {};

  if (!content.startsWith("---")) {
    return { frontmatter, body: content };
  }

  const endIndex = content.indexOf("\n---", 3);
  if (endIndex === -1) {
    return { frontmatter, body: content };
  }

  const block = content.slice(4, endIndex);
  const body = content.slice(endIndex + 4).trim();

  for (const line of block.split("\n")) {
    const trimmed = line.trim();
    const match = trimmed.match(/^([\w-]+):\s*(.*)$/);
    if (match) {
      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      frontmatter[match[1]] = value;
    }
  }

  return { frontmatter, body };
}

// ---------------------------------------------------------------------------
// Agent discovery
// ---------------------------------------------------------------------------

function discoverAgents(): AgentInfo[] {
  const map = new Map<string, AgentInfo>();
  const dirs = [
    path.join(os.homedir(), ".pi", "agent", "agents"),
    path.join(os.homedir(), ".agents"),
  ];

  for (const dir of dirs) {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        const fileName = entry.name.slice(0, -3);
        if (map.has(fileName) || fileName.startsWith(".")) continue;

        const content = fs.readFileSync(
          path.join(dir, entry.name),
          "utf-8",
        );
        const { frontmatter } = parseFrontmatter(content);

        const name = frontmatter.name || fileName;
        const description = frontmatter.description || name;

        map.set(name, { name, description });
      }
    } catch {
      // skip
    }
  }
  return Array.from(map.values());
}

// ---------------------------------------------------------------------------
// Setup state management
// ---------------------------------------------------------------------------

function loadState(): SetupState | null {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")) as SetupState;
    }
  } catch {
    // ignore corrupt state
  }
  return null;
}

function saveState(state: SetupState): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n", "utf-8");
}

function readSettings(): Record<string, unknown> {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
    }
  } catch {
    // ignore
  }
  return {};
}

function writeSettings(settings: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(
    SETTINGS_FILE,
    JSON.stringify(settings, null, 2) + "\n",
    "utf-8",
  );
}

// ---------------------------------------------------------------------------
// Agent file operations
// ---------------------------------------------------------------------------

/** Collect all .md files from the bundled agents/ directory. */
function listBundledAgentFiles(): string[] {
  try {
    return fs
      .readdirSync(AGENT_SRC_DIR, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/** Read bundled agent file content for content comparison. */
function readBundledAgentContent(name: string): string | null {
  try {
    return fs.readFileSync(path.join(AGENT_SRC_DIR, name), "utf-8");
  } catch {
    return null;
  }
}

/** Install bundled agent files to the user agent directory. */
function installAgentFiles(ctx: {
  ui: {
    notify: (msg: string, level: string) => void;
  };
}): void {
  const files = listBundledAgentFiles();
  if (files.length === 0) {
    ctx.ui.notify(
      `${PACKAGE_NAME}: 未找到捆绑的 agent 文件，跳过安装`,
      "warning",
    );
    return;
  }

  fs.mkdirSync(AGENT_TARGET_DIR, { recursive: true });

  let installed = 0;
  let skipped = 0;
  for (const file of files) {
    const target = path.join(AGENT_TARGET_DIR, file);
    if (fs.existsSync(target)) {
      skipped++;
      continue;
    }
    const content = readBundledAgentContent(file);
    if (content) {
      fs.writeFileSync(target, content, "utf-8");
      installed++;
    }
  }

  ctx.ui.notify(
    `${PACKAGE_NAME}: agent 文件安装完成 (新装 ${installed}, 已存在 ${skipped})`,
    installed > 0 ? "info" : "warning",
  );
}

/** Remove agent files that were installed by this extension (content match check). */
function uninstallAgentFiles(ctx: {
  ui: {
    notify: (msg: string, level: string) => void;
  };
}, state: SetupState): void {
  if (!state.agentFiles || state.agentFiles.length === 0) {
    ctx.ui.notify(`${PACKAGE_NAME}: 没有由扩展安装的 agent 文件`, "info");
    return;
  }

  let removed = 0;
  let kept = 0;
  for (const file of state.agentFiles) {
    const target = path.join(AGENT_TARGET_DIR, file);
    if (!fs.existsSync(target)) {
      kept++;
      continue;
    }

    // Safety check: only delete if content matches the bundled version
    const bundled = readBundledAgentContent(file);
    if (bundled === null) {
      // Bundle agent removed in newer version — safe to delete tracked file
      try {
        fs.unlinkSync(target);
        removed++;
      } catch {
        kept++;
      }
      continue;
    }

    try {
      const current = fs.readFileSync(target, "utf-8");
      if (current === bundled) {
        fs.unlinkSync(target);
        removed++;
      } else {
        kept++;
      }
    } catch {
      kept++;
    }
  }

  state.agentFiles = [];
  saveState(state);

  ctx.ui.notify(
    `${PACKAGE_NAME}: agent 文件清理完成 (移除 ${removed}, 保留 ${kept})`,
    "info",
  );
}

// ---------------------------------------------------------------------------
// disableBuiltins settings management
// ---------------------------------------------------------------------------

function setDisableBuiltins(
  value: boolean,
  ctx: { ui: { notify: (msg: string, level: string) => void } },
): void {
  const settings = readSettings();
  const subagents = (settings.subagents as Record<string, unknown>) ?? {};

  if (value) {
    (settings.subagents as Record<string, unknown>) = {
      ...subagents,
      disableBuiltins: true,
    };
  } else {
    if (subagents && typeof subagents === "object") {
      const cleaned = { ...subagents } as Record<string, unknown>;
      delete cleaned.disableBuiltins;
      if (Object.keys(cleaned).length > 0) {
        settings.subagents = cleaned;
      } else {
        delete settings.subagents;
      }
    }
  }

  writeSettings(settings);
  ctx.ui.notify(
    `${PACKAGE_NAME}: disableBuiltins 已${value ? "启用" : "关闭"}，请执行 /reload 生效`,
    "info",
  );
}

// ---------------------------------------------------------------------------
// Orchestrator prompt builder
// ---------------------------------------------------------------------------

function buildOrchestratorPrompt(agentList: AgentInfo[]): string {
  const agentsBlock = agentList
    .filter((a) => a.name !== "orchestrator")
    .map((a) => `- **${a.name}**: ${a.description}`)
    .join("\n");

  return `## Your Role: Workflow Orchestrator

You are a workflow manager for coding work. Your job is to plan, schedule, delegate, monitor, reconcile, and verify specialist-agent work. You are NOT the default implementation worker.

### Available Subagents

${agentsBlock}

### Delegation

When the user includes a DIRECT DELEGATION like \`→agentname: task\` at the START of their message, you MUST call the \`subagent\` tool with:

\`\`\`json
{ "agent": "agentname", "task": "task description" }
\`\`\`

Do NOT rephrase the delegation. Do NOT answer yourself. Call the tool immediately.

### Workflow
1. Understand the request
2. Delegate to appropriate subagent (or execute directly if trivial)
3. Verify results
4. Report concisely`;
}

// ---------------------------------------------------------------------------
// Autocomplete wrapper
// ---------------------------------------------------------------------------

function createAutocompleteWrapper(
  agents: AgentInfo[],
): AutocompleteProviderFactory {
  return (current) => ({
    ...current,
    triggerCharacters: ["@"],
    async getSuggestions(lines, cursorLine, cursorCol, options) {
      const textBefore = (lines[cursorLine] || "").slice(0, cursorCol);
      const atMatch = textBefore.match(/(?:^|\s)@(\S*)$/);
      if (!atMatch)
        return current.getSuggestions(
          lines,
          cursorLine,
          cursorCol,
          options,
        );
      const query = atMatch[1].toLowerCase();
      if (query.includes("/") || query.includes("\\"))
        return current.getSuggestions(
          lines,
          cursorLine,
          cursorCol,
          options,
        );
      const matched = agents.filter((a) =>
        a.name.toLowerCase().startsWith(query),
      );
      if (matched.length > 0)
        return {
          items: matched.map((a) => ({
            value: `@${a.name}`,
            label: a.name,
            description: a.description,
          })),
          prefix: `@${query}`,
        };
      return current.getSuggestions(
        lines,
        cursorLine,
        cursorCol,
        options,
      );
    },
    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      if (item.value.startsWith("@") && !item.value.includes("/")) {
        const line = lines[cursorLine] || "";
        const before = line.slice(0, cursorCol - prefix.length);
        const after = line.slice(cursorCol);
        const agentName = item.value.slice(1);
        const newLines = [...lines];
        newLines[cursorLine] = `${before}@${agentName} ${after}`;
        return {
          lines: newLines,
          cursorLine,
          cursorCol: before.length + agentName.length + 2,
        };
      }
      return current.applyCompletion(
        lines,
        cursorLine,
        cursorCol,
        item,
        prefix,
      );
    },
  });
}

// ---------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------

interface MentionResult {
  agentName: string;
  task: string;
}

function parseMention(text: string): MentionResult | null {
  const trimmed = text.trim();
  const match = trimmed.match(/^@(\S{2,})\s*(.*)/s);
  if (!match) return null;
  const agentName = match[1];
  const task = match[2].trim();
  if (!task) return null;
  return { agentName, task };
}

// ---------------------------------------------------------------------------
// Delegation prompt builder
// ---------------------------------------------------------------------------

function buildDelegationPrompt(agentList: AgentInfo[]): string {
  const agentNameList = agentList
    .filter((a) => a.name !== "orchestrator")
    .map((a) => `@${a.name}`)
    .join(", ");

  return `\n\n## Direct Delegation
When the user starts a message with @agentname (e.g. @oracle), you MUST:
1. IMMEDIATELY call the \`subagent\` tool
2. Use the agent name (without @) and the user's task as parameters
3. DO NOT answer the question yourself — delegate it

Available agents: ${agentNameList}
Recognize @agentname as delegation, do NOT treat it as text or a file reference.
Use the subagent tool format: subagent({ agent: "name", task: "task" })`;
}

// ---------------------------------------------------------------------------
// Setup / configuration command
// ---------------------------------------------------------------------------

async function runSetup(ctx: {
  ui: {
    confirm: (title: string, msg: string) => Promise<boolean>;
    notify: (msg: string, level: string) => void;
  };
  hasUI: boolean;
}): Promise<SetupState> {
  const state = loadState() ?? {
    version: CURRENT_VERSION,
    setupCompleted: false,
    agentFiles: [],
    disableBuiltinsSet: false,
  };

  // --- Agent files ---
  if (!ctx.hasUI) {
    // Non-interactive: just ensure agent files exist
    const files = listBundledAgentFiles();
    fs.mkdirSync(AGENT_TARGET_DIR, { recursive: true });
    for (const file of files) {
      const target = path.join(AGENT_TARGET_DIR, file);
      if (!fs.existsSync(target)) {
        const content = readBundledAgentContent(file);
        if (content) fs.writeFileSync(target, content, "utf-8");
      }
    }
    // Also install if agentFiles list is empty (first run in headless mode)
    if (state.agentFiles.length === 0) {
      state.agentFiles = files;
    }
  } else {
    // Interactive
    const files = listBundledAgentFiles();
    const existingFiles = state.agentFiles.filter((f) =>
      fs.existsSync(path.join(AGENT_TARGET_DIR, f)),
    );

    if (existingFiles.length > 0) {
      // Already installed → offer to remove
      const remove = await ctx.ui.confirm(
        "管理 agent 文件",
        `已安装 ${existingFiles.length} 个 agent 文件。是否移除由扩展安装的 agent 文件？`,
      );
      if (remove) {
        uninstallAgentFiles(ctx, state);
      }
    } else {
      // Not installed → offer to install
      const install = await ctx.ui.confirm(
        "安装自定义 agent？",
        `将 ${files.length} 个 agent 定义文件复制到 ${AGENT_TARGET_DIR}？\n(council, designer, explorer, fixer, librarian, observer, oracle, orchestrator)`,
      );
      if (install) {
        installAgentFiles(ctx);
        state.agentFiles = files;
      }
    }
  }

  // --- disableBuiltins ---
  if (!ctx.hasUI) {
    // Non-interactive: skip
  } else {
    const settings = readSettings();
    const currentValue =
      (settings.subagents as Record<string, unknown>)?.disableBuiltins;

    if (state.disableBuiltinsSet && currentValue === true) {
      // We set it, offer to revert
      const restore = await ctx.ui.confirm(
        "内置 subagent 设置",
        "当前已启用 disableBuiltins（由扩展设置）。是否恢复（关闭 disableBuiltins）？",
      );
      if (restore) {
        setDisableBuiltins(false, ctx);
        state.disableBuiltinsSet = false;
      }
    } else if (!state.disableBuiltinsSet && currentValue === undefined) {
      // Not yet configured, offer to set
      const disable = await ctx.ui.confirm(
        "禁用内置 subagent？",
        "设置 'disableBuiltins: true' 将禁用 pi-subagents 的内置 agent（如 delegate, planner, researcher 等），\n仅使用你的自定义 agent。可通过 /mention-setup 随时更改。",
      );
      if (disable) {
        setDisableBuiltins(true, ctx);
        state.disableBuiltinsSet = true;
      }
    }
    // else: manually set by user, don't touch
  }

  // --- Finalize ---
  state.version = CURRENT_VERSION;
  state.setupCompleted = true;
  saveState(state);

  if (ctx.hasUI) {
    ctx.ui.notify(`${PACKAGE_NAME}: 配置完成`, "info");
  }

  return state;
}

// ---------------------------------------------------------------------------
// Main extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  // Skip entirely in subagent child processes
  if (process.env.PI_SUBAGENT_CHILD === "1") return;

  // -----------------------------------------------------------------------
  // Register /mention-setup command
  // -----------------------------------------------------------------------
  pi.registerCommand("mention-setup", {
    description: "配置 pi-at-mention（安装/卸载 agent、切换 disableBuiltins）",
    handler: async (_args, ctx) => {
      await runSetup(ctx);
    },
  });

  // -----------------------------------------------------------------------
  // session_start: setup check + autocomplete registration
  // -----------------------------------------------------------------------
  pi.on("session_start", async (_event, ctx) => {
    // 1. Check pi-subagents availability
    const hasSubagent = pi
      .getAllTools()
      .some((t) => t.name === "subagent");
    if (!hasSubagent) {
      ctx.ui.notify(
        `${PACKAGE_NAME}: pi-subagents 未安装或未注册 subagent 工具，扩展将跳过`,
        "error",
      );
      return;
    }

    // 2. Check state and auto-repair if needed (installs agent files on first run)
    const state = loadState();

    if (!state || !state.setupCompleted) {
      // First run — execute setup (installs agent files if needed)
      await runSetup(ctx);
    } else {
      // Normal startup — check agent file integrity
      const missingFiles = state.agentFiles.filter(
        (f) => !fs.existsSync(path.join(AGENT_TARGET_DIR, f)),
      );

      if (missingFiles.length > 0 && ctx.hasUI) {
        const reinstall = await ctx.ui.confirm(
          "检测到缺失 agent 文件",
          `以下 ${missingFiles.length} 个 agent 文件已被删除：\n${missingFiles.join("\n")}\n\n是否重新安装？`,
        );
        if (reinstall) {
          ctx.ui.notify(
            `${PACKAGE_NAME}: 重新安装缺失的 agent 文件中...`,
            "info",
          );
          for (const file of missingFiles) {
            const target = path.join(AGENT_TARGET_DIR, file);
            if (!fs.existsSync(target)) {
              const content = readBundledAgentContent(file);
              if (content) {
                fs.writeFileSync(target, content, "utf-8");
                ctx.ui.notify(`${PACKAGE_NAME}: 已恢复 ${file}`, "info");
              }
            }
          }
        } else {
          state.agentFiles = state.agentFiles.filter(
            (f) => !missingFiles.includes(f),
          );
          saveState(state);
        }
      }
    }

    // 3. Discover agents dynamically (after potential setup above)
    const agentList = discoverAgents();
    if (agentList.length === 0) {
      ctx.ui.notify(
        `${PACKAGE_NAME}: 未发现任何 agent 文件，@ 补全不可用。运行 /mention-setup 安装内置 agent`,
        "warning",
      );
      return;
    }

    // 4. Register autocomplete with current agent list
    if (ctx.ui && typeof ctx.ui.addAutocompleteProvider === "function") {
      ctx.ui.addAutocompleteProvider(createAutocompleteWrapper(agentList));
    }
  });

  // -----------------------------------------------------------------------
  // before_agent_start: inject orchestrator prompt (only in main process)
  // -----------------------------------------------------------------------
  pi.on("before_agent_start", async (event) => {
    if (process.env.PI_SUBAGENT_CHILD === "1") return;
    if (event.systemPrompt.includes(ORCHESTRATOR_MARKER)) return;

    // Discover agents dynamically so changes after /mention-setup take effect
    const agentList = discoverAgents();
    if (agentList.length === 0) return;

    return {
      systemPrompt:
        event.systemPrompt +
        "\n\n" +
        buildOrchestratorPrompt(agentList) +
        buildDelegationPrompt(agentList),
    };
  });

  // -----------------------------------------------------------------------
  // input: @agentname task → direct delegation instruction
  // -----------------------------------------------------------------------
  pi.on("input", async (event) => {
    const result = parseMention(event.text);
    if (!result) return { action: "continue" };

    // Discover agents dynamically so newly installed agents are recognized
    const agentList = discoverAgents();
    const agentNames = new Set(agentList.map((a) => a.name));
    if (!agentNames.has(result.agentName)) return { action: "continue" };

    return {
      action: "transform",
      text: `[DIRECT DELEGATION]
You have ONE job: call the subagent tool with these exact parameters.
Agent: "${result.agentName}"
Task: "${result.task}"

Call: subagent({ agent: "${result.agentName}", task: "${result.task}" })

DO NOT answer the question.
DO NOT rephrase the task.
DO NOT explain what you're doing.
ONLY call the subagent tool and return its result.`,
      images: event.images,
    };
  });
}
