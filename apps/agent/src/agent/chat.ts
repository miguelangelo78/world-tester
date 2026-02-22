import { GoogleGenerativeAI } from "@google/generative-ai";
import { AppConfig } from "../config/types.js";
import { SiteKnowledge, Learning, SessionEntry } from "../memory/types.js";
import { buildSystemPrompt } from "./system-prompt.js";
import type { BrowserPool } from "../browser/pool.js";
import type { OutputSink } from "../output-sink.js";
import type { ConversationMessageDTO } from "@world-tester/shared";

export type ChatAction =
  | "chat" | "task" | "act" | "goto" | "learn" | "extract" | "observe"
  | "spawn_browser" | "switch_browser";

export interface ChatResponse {
  action: ChatAction;
  message?: string;
  instruction?: string;
  options?: Record<string, unknown>;
  inputTokens: number;
  outputTokens: number;
}

const CHAT_IDENTITY = `You are World Tester — a friendly, sharp-eyed QA engineer who lives in the browser.
Your personality: cheerful but meticulous, you love catching bugs and you take pride in your work.
You speak casually like a colleague (not corporate-speak), use short sentences, and occasionally crack a dry joke about software quality.
You are always helpful: if the user asks a vague question, you do your best with what you know rather than refusing.

You have deep knowledge of the websites you've tested. Your site knowledge and learnings (provided below) are accumulated across ALL conversations and sessions — they are your persistent memory.
IMPORTANT: When the user asks a factual question about a site you've tested, ALWAYS check your site knowledge and learnings FIRST. If the answer is already there, respond directly from memory — do NOT suggest going to the browser to check. Only suggest browser actions if the information genuinely isn't in your knowledge.
If you don't know something, say so honestly — but suggest how you could find out (e.g. "I haven't explored that page yet — want me to learn it?").

You can also give QA advice, testing strategies, and help plan test scenarios.
Today's date is ${new Date().toISOString().split("T")[0]}.`;

const CLASSIFY_PROMPT = `Classify the user's message. Respond with EXACTLY one short JSON object (no markdown, no backticks, just raw JSON).

Actions:
  {"action": "chat"} — ONLY for pure questions, greetings, opinions, or advice requests
  {"action": "task", "instruction": "..."} — complex multi-step browser work
  {"action": "act", "instruction": "..."} — single browser action (click, toggle, scroll)
  {"action": "goto", "instruction": "https://..."} — navigate to a URL
  {"action": "learn", "instruction": "..."} — explore/learn a page
  {"action": "extract", "instruction": "..."} — read data from the page or observe visual details
  {"action": "spawn_browser", "instruction": "<name>", "options": {"isolated": true}} — open a new browser instance
  {"action": "switch_browser", "instruction": "<name>"} — switch to an existing browser instance

Examples:
  "switch to light mode" → {"action": "act", "instruction": "click the dark/light mode toggle"}
  "change risk to 5%" → {"action": "task", "instruction": "change risk % to 5%"}
  "what pages have you learned?" → {"action": "chat"}
  "go to account settings" → {"action": "task", "instruction": "navigate to account settings page"}
  "click the save button" → {"action": "act", "instruction": "click the Save button"}
  "let's try that again" → {"action": "task", "instruction": "..."} (infer from context what to retry)
  "open a new browser as userB" → {"action": "spawn_browser", "instruction": "userB", "options": {"isolated": true}}
  "switch to the admin browser" → {"action": "switch_browser", "instruction": "admin"}

Rules:
- Any message that asks to DO, CHANGE, CLICK, SWITCH, TRY, OPEN, UPDATE, SET, TOGGLE, or NAVIGATE is a browser action. NEVER classify these as chat.
- "open a new browser", "spawn browser", "launch another browser" → spawn_browser
- "switch to browser X", "use browser X" → switch_browser (only if a browser with that name exists)
- Even if a similar task failed before, still classify it as a browser action — the user wants to try again.
- IMPORTANT: If the user asks a QUESTION about something the agent already knows from site knowledge or learnings (e.g. "what color is the logo?", "what pages exist?", "how do I navigate to settings?"), classify as "chat" — the agent can answer from memory without using the browser.
- Only use "extract" when the user explicitly wants LIVE data from the current page that may not be in stored knowledge.
- Only use "chat" when the user is genuinely asking a question or making conversation with no action implied.
- For browser actions, write the instruction as if telling a browser agent. Be specific.
- Do NOT include a message field for browser actions, only instruction.
- When the user says "try again", "do it again", "retry", etc., infer the instruction ONLY from the MOST RECENT task or topic in the conversation — NOT from older history.
- Keep it short. This is classification only.`;

interface ChatMessage {
  role: "user" | "model";
  parts: { text: string }[];
}

let chatHistory: ChatMessage[] = [];

export function resetChatHistory(): void {
  chatHistory = [];
}

export function addToHistory(role: "user" | "model", text: string): void {
  chatHistory.push({ role, parts: [{ text }] });
  if (chatHistory.length > 40) {
    chatHistory = chatHistory.slice(-30);
  }
  sanitizeHistory();
}

export function injectSessionContext(entries: SessionEntry[]): void {
  const recent = entries.slice(-20);
  for (const entry of recent) {
    chatHistory.push({
      role: entry.role === "user" ? "user" : "model",
      parts: [{ text: entry.content }],
    });
  }
  sanitizeHistory();
}

export function loadConversationContext(messages: ConversationMessageDTO[]): void {
  resetChatHistory();
  const relevant = messages
    .filter((m) => m.role === "user" || m.role === "agent")
    .slice(-30);
  for (const m of relevant) {
    chatHistory.push({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: m.content }],
    });
  }
  sanitizeHistory();
}

/**
 * Gemini requires history to start with a "user" message and to alternate
 * user/model without consecutive same-role entries. Strip leading model
 * messages and merge consecutive same-role messages.
 */
function sanitizeHistory(): void {
  // Drop leading model messages
  while (chatHistory.length > 0 && chatHistory[0].role === "model") {
    chatHistory.shift();
  }

  // Merge consecutive same-role entries
  const merged: ChatMessage[] = [];
  for (const msg of chatHistory) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === msg.role) {
      prev.parts[0].text += "\n" + msg.parts[0].text;
    } else {
      merged.push({ role: msg.role, parts: [{ text: msg.parts[0].text }] });
    }
  }
  chatHistory = merged;
}

function getRecentContextHint(): string {
  const recent = chatHistory.slice(-6);
  if (recent.length === 0) return "";
  return recent
    .map((m) => `${m.role === "user" ? "User" : "Agent"}: ${m.parts[0].text.slice(0, 150)}`)
    .join("\n");
}

function buildModel(config: AppConfig, systemText: string) {
  const genAI = new GoogleGenerativeAI(config.apiKey);
  return genAI.getGenerativeModel({
    model: config.utilityModel.replace("google/", ""),
    systemInstruction: { role: "user", parts: [{ text: systemText }] },
  });
}

function buildSystemText(
  currentUrl: string,
  siteKnowledge: SiteKnowledge | null,
  learnings: Learning[],
): string {
  const knowledgeContext = buildSystemPrompt(siteKnowledge, learnings, {
    skipBasePrompt: true,
  });
  return [
    CHAT_IDENTITY,
    `The browser is currently on: ${currentUrl}`,
    knowledgeContext || "You haven't learned any sites yet.",
  ].join("\n\n");
}

/**
 * Pure conversational chat — streams the reply, no intent detection.
 * Used for explicit `c:` prefix.
 */
export async function runChat(
  message: string,
  config: AppConfig,
  siteKnowledge: SiteKnowledge | null,
  learnings: Learning[],
  currentUrl: string,
  sink?: OutputSink,
): Promise<ChatResponse> {
  const systemText = buildSystemText(currentUrl, siteKnowledge, learnings);
  const model = buildModel(config, systemText);
  const chat = model.startChat({ history: chatHistory });

  const streamResult = await chat.sendMessageStream(message);
  const writer = sink?.write ?? ((t: string) => process.stdout.write(t));

  let fullReply = "";
  writer("\n");
  for await (const chunk of streamResult.stream) {
    const text = chunk.text();
    if (text) {
      writer(text);
      fullReply += text;
    }
  }
  writer("\n");

  const response = await streamResult.response;

  addToHistory("user", message);
  addToHistory("model", fullReply);

  const usage = response.usageMetadata;
  return {
    action: "chat",
    message: fullReply,
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: usage?.candidatesTokenCount ?? 0,
  };
}

/**
 * Two-phase smart routing:
 *   Phase 1 — cheap non-streaming classification (chat vs browser action)
 *   Phase 2 — if chat, make a streaming call for the actual reply;
 *             if browser action, return immediately for orchestrator handoff.
 */
export async function runSmartChat(
  message: string,
  config: AppConfig,
  siteKnowledge: SiteKnowledge | null,
  learnings: Learning[],
  currentUrl: string,
  pool?: BrowserPool,
  sink?: OutputSink,
): Promise<ChatResponse> {
  const baseSystemText = buildSystemText(currentUrl, siteKnowledge, learnings);

  const recentContext = getRecentContextHint();
  const browserContext = pool
    ? `\nActive browsers: ${pool.list().map(b => `"${b.name}"`).join(", ") || "none"}. Active: "${pool.activeLabel()}".`
    : "";
  const classifySystemText = baseSystemText + browserContext + "\n\n" + CLASSIFY_PROMPT +
    (recentContext ? `\n\nRecent conversation context (use this to resolve "again", "retry", "that", etc.):\n${recentContext}` : "");

  const classifyModel = buildModel(config, classifySystemText);
  const classifyChat = classifyModel.startChat({ history: chatHistory });
  const classifyResult = await classifyChat.sendMessage(message);
  const classifyResponse = classifyResult.response;
  const raw = classifyResponse.text().trim();

  const classifyUsage = classifyResponse.usageMetadata;
  const classifyIn = classifyUsage?.promptTokenCount ?? 0;
  const classifyOut = classifyUsage?.candidatesTokenCount ?? 0;

  const parsed = parseActionJson(raw);

  if (parsed && parsed.action !== "chat") {
    addToHistory("user", message);
    return {
      action: parsed.action,
      instruction: parsed.instruction ?? message,
      options: parsed.options,
      inputTokens: classifyIn,
      outputTokens: classifyOut,
    };
  }

  // Phase 2: stream the conversational reply (full personality, no routing prompt)
  const chatModel = buildModel(config, baseSystemText);
  const chat = chatModel.startChat({ history: chatHistory });
  const streamResult = await chat.sendMessageStream(message);
  const writer = sink?.write ?? ((t: string) => process.stdout.write(t));

  let fullReply = "";
  writer("\n");
  for await (const chunk of streamResult.stream) {
    const text = chunk.text();
    if (text) {
      writer(text);
      fullReply += text;
    }
  }
  writer("\n");

  const streamResponse = await streamResult.response;
  const streamUsage = streamResponse.usageMetadata;

  addToHistory("user", message);
  addToHistory("model", fullReply);

  return {
    action: "chat",
    message: fullReply,
    inputTokens: classifyIn + (streamUsage?.promptTokenCount ?? 0),
    outputTokens: classifyOut + (streamUsage?.candidatesTokenCount ?? 0),
  };
}

function parseActionJson(
  raw: string,
): { action: ChatAction; message?: string; instruction?: string; options?: Record<string, unknown> } | null {
  const validActions: ChatAction[] = [
    "chat", "task", "act", "goto", "learn", "extract", "observe",
    "spawn_browser", "switch_browser",
  ];

  // Strip markdown code fences if present
  let cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  const extractFields = (obj: any) => ({
    action: obj.action as ChatAction,
    message: typeof obj.message === "string" ? obj.message : undefined,
    instruction: typeof obj.instruction === "string" ? obj.instruction : undefined,
    options: typeof obj.options === "object" && obj.options !== null ? obj.options : undefined,
  });

  // Try direct parse first
  try {
    const obj = JSON.parse(cleaned);
    if (obj && typeof obj.action === "string" && validActions.includes(obj.action)) {
      return extractFields(obj);
    }
  } catch {
    // JSON.parse failed — model may have put literal newlines inside string values
  }

  // Second pass: escape literal newlines inside JSON string values
  try {
    const escaped = cleaned.replace(
      /("(?:message|instruction)":\s*")([\s\S]*?)("(?:\s*[,}]))/g,
      (_, prefix: string, content: string, suffix: string) =>
        prefix + content.replace(/\n/g, "\\n").replace(/\r/g, "\\r") + suffix,
    );
    const obj = JSON.parse(escaped);
    if (obj && typeof obj.action === "string" && validActions.includes(obj.action)) {
      return extractFields(obj);
    }
  } catch {
    // Still not valid JSON
  }

  // Fallback: regex extraction for when the model wraps text around JSON
  const actionMatch = cleaned.match(/"action"\s*:\s*"(\w+)"/);
  const msgMatch = cleaned.match(/"message"\s*:\s*"([\s\S]*?)"\s*[,}]/);
  const instrMatch = cleaned.match(/"instruction"\s*:\s*"([\s\S]*?)"\s*[,}]/);
  if (actionMatch && validActions.includes(actionMatch[1] as ChatAction)) {
    return {
      action: actionMatch[1] as ChatAction,
      message: msgMatch?.[1]?.replace(/\\n/g, "\n"),
      instruction: instrMatch?.[1]?.replace(/\\n/g, "\n"),
    };
  }

  return null;
}
