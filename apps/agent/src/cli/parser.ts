export type CommandMode =
  | "extract"
  | "act"
  | "task"
  | "observe"
  | "search"
  | "ask"
  | "goto"
  | "learn"
  | "chat"
  | "test"
  | "auto";

export interface ParsedCommand {
  mode: CommandMode;
  instruction: string;
  raw: string;
  targetBrowser?: string;
  targetTab?: number | string;
}

export type BrowserCommand =
  | { type: "browser_list" }
  | { type: "browser_spawn"; name: string; isolated: boolean }
  | { type: "browser_kill"; name: string }
  | { type: "browser_switch"; name: string }
  | { type: "tab_list" }
  | { type: "tab_new"; url?: string }
  | { type: "tab_switch"; target: string }
  | { type: "tab_close"; index?: number };

export type ConversationCommand =
  | { type: "conv_list" }
  | { type: "conv_new"; title?: string }
  | { type: "conv_switch"; target: string }
  | { type: "conv_rename"; title: string }
  | { type: "conv_archive" };

const PREFIX_MAP: Record<string, CommandMode> = {
  "e:": "extract",
  "a:": "act",
  "t:": "task",
  "o:": "observe",
  "s:": "search",
  "?:": "ask",
  "g:": "goto",
  "l:": "learn",
  "c:": "chat",
  "test:": "test",
};

/**
 * Try to parse a browser/tab management command.
 * Returns null when the input is not a browser/tab command.
 */
export function parseBrowserCommand(input: string): BrowserCommand | null {
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();

  if (lower === "browser" || lower === "browsers") {
    return { type: "browser_list" };
  }

  const spawnMatch = trimmed.match(
    /^browser[:\s]spawn\s+(\S+)(\s+--isolated)?$/i,
  );
  if (spawnMatch) {
    return {
      type: "browser_spawn",
      name: spawnMatch[1],
      isolated: !!spawnMatch[2],
    };
  }

  const killMatch = trimmed.match(/^browser[:\s]kill\s+(\S+)$/i);
  if (killMatch) {
    return { type: "browser_kill", name: killMatch[1] };
  }

  const switchMatch = trimmed.match(/^browser[:\s]switch\s+(\S+)$/i);
  if (switchMatch) {
    return { type: "browser_switch", name: switchMatch[1] };
  }

  if (lower === "tab" || lower === "tabs") {
    return { type: "tab_list" };
  }

  const tabNewMatch = trimmed.match(/^tab[:\s]new(?:\s+(.+))?$/i);
  if (tabNewMatch) {
    return { type: "tab_new", url: tabNewMatch[1]?.trim() || undefined };
  }

  const tabSwitchMatch = trimmed.match(/^tab[:\s]switch\s+(.+)$/i);
  if (tabSwitchMatch) {
    return { type: "tab_switch", target: tabSwitchMatch[1].trim() };
  }

  const tabCloseMatch = trimmed.match(/^tab[:\s]close(?:\s+(\d+))?$/i);
  if (tabCloseMatch) {
    return {
      type: "tab_close",
      index: tabCloseMatch[1] !== undefined
        ? parseInt(tabCloseMatch[1], 10)
        : undefined,
    };
  }

  return null;
}

/**
 * Try to parse a conversation management command.
 * Returns null when the input is not a conversation command.
 */
export function parseConversationCommand(input: string): ConversationCommand | null {
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();

  if (lower === "conv" || lower === "conversations") {
    return { type: "conv_list" };
  }

  const newMatch = trimmed.match(/^conv[:\s]new(?:\s+(.+))?$/i);
  if (newMatch) {
    return { type: "conv_new", title: newMatch[1]?.trim() || undefined };
  }

  const switchMatch = trimmed.match(/^conv[:\s]switch\s+(.+)$/i);
  if (switchMatch) {
    return { type: "conv_switch", target: switchMatch[1].trim() };
  }

  const renameMatch = trimmed.match(/^conv[:\s]rename\s+(.+)$/i);
  if (renameMatch) {
    return { type: "conv_rename", title: renameMatch[1].trim() };
  }

  if (lower === "conv:archive" || lower === "conv archive") {
    return { type: "conv_archive" };
  }

  return null;
}

/**
 * Parse a regular agent command.
 * Strips an optional `@browserName` prefix used for targeting a specific browser.
 */
export function parseCommand(input: string): ParsedCommand {
  let trimmed = input.trim();

  let targetBrowser: string | undefined;
  let targetTab: number | string | undefined;
  const atMatch = trimmed.match(/^@(\S+)\s+(.+)$/);
  if (atMatch) {
    const target = atMatch[1];
    trimmed = atMatch[2].trim();

    const colonIdx = target.indexOf(":");
    if (colonIdx !== -1) {
      targetBrowser = target.slice(0, colonIdx);
      const tabPart = target.slice(colonIdx + 1);
      const asNum = parseInt(tabPart, 10);
      targetTab = !isNaN(asNum) && String(asNum) === tabPart ? asNum : tabPart;
    } else {
      targetBrowser = target;
    }
  }

  for (const [prefix, mode] of Object.entries(PREFIX_MAP)) {
    if (trimmed.toLowerCase().startsWith(prefix)) {
      return {
        mode,
        instruction: trimmed.slice(prefix.length).trim(),
        raw: trimmed,
        targetBrowser,
        targetTab,
      };
    }
  }

  if (trimmed.toLowerCase() === "l" || trimmed.toLowerCase() === "learn") {
    return { mode: "learn", instruction: "", raw: trimmed, targetBrowser, targetTab };
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return { mode: "goto", instruction: trimmed, raw: trimmed, targetBrowser, targetTab };
  }

  return { mode: "auto", instruction: trimmed, raw: trimmed, targetBrowser, targetTab };
}

export function getHelpText(): string {
  return [
    "Commands:",
    "  e: <prompt>   Extract information from the current page",
    "  a: <prompt>   Perform a single action (click, type, etc.)",
    "  t: <prompt>   Execute a complex, multi-step task",
    "  o: <prompt>   Observe what's available on the page",
    "  s: <query>    Search the web using the browser",
    "  ?: <question> Ask the agent a question about the page",
    "  c: <message>  Chat with the agent (conversational, uses knowledge)",
    "  g: <url>      Navigate to a URL (or just paste a URL)",
    "  l / l: [focus] Learn the current website (map pages, forms, flows)",
    "  test: <ticket> Run a QA test — plans steps, executes, verifies, reports",
    "  (no prefix)   Agent decides the best approach (or chats if conversational)",
    "",
    "  @name <cmd>       Target a specific browser (e.g. @userA t: go to settings)",
    "  @name:tab <cmd>   Target a browser + tab (e.g. @userA:1 e: extract data)",
    "                     Tab can be an index (0, 1, ...) or a URL fragment",
    "",
    "Browser management:",
    "  browser                       List all browsers and their tabs",
    "  browser:spawn <name> [--isolated]  Launch a new browser instance",
    "  browser:kill <name>           Close a browser instance",
    "  browser:switch <name>         Switch active browser",
    "",
    "Tab management:",
    "  tab                           List tabs in the active browser",
    "  tab:new [url]                 Open a new tab",
    "  tab:switch <index or url>     Switch active tab",
    "  tab:close [index]             Close a tab",
    "",
    "Conversation management:",
    "  conv                          List all conversations",
    "  conv:new [title]              Create a new conversation (and switch to it)",
    "  conv:switch <id or index>     Switch to a different conversation",
    "  conv:rename <title>           Rename the current conversation",
    "  conv:archive                  Archive the current conversation",
    "",
    "  help          Show this help text",
    "  cost          Show session cost summary",
    "  history       Show recent task history",
    "  knowledge     Show what the agent knows about this site",
    "  quit / exit   Close all browsers and exit",
  ].join("\n");
}
