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
}

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

export function parseCommand(input: string): ParsedCommand {
  const trimmed = input.trim();

  for (const [prefix, mode] of Object.entries(PREFIX_MAP)) {
    if (trimmed.toLowerCase().startsWith(prefix)) {
      return {
        mode,
        instruction: trimmed.slice(prefix.length).trim(),
        raw: trimmed,
      };
    }
  }

  if (trimmed.toLowerCase() === "l" || trimmed.toLowerCase() === "learn") {
    return { mode: "learn", instruction: "", raw: trimmed };
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return { mode: "goto", instruction: trimmed, raw: trimmed };
  }

  return { mode: "auto", instruction: trimmed, raw: trimmed };
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
    "  help          Show this help text",
    "  cost          Show session cost summary",
    "  history       Show recent task history",
    "  knowledge     Show what the agent knows about this site",
    "  quit / exit   Close the browser and exit",
  ].join("\n");
}
