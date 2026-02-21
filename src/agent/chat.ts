import { GoogleGenerativeAI } from "@google/generative-ai";
import { AppConfig } from "../config/types.js";
import { SiteKnowledge, Learning, SessionEntry } from "../memory/types.js";
import { buildSystemPrompt } from "./system-prompt.js";

const CHAT_IDENTITY = `You are World Tester — a friendly, sharp-eyed QA engineer who lives in the browser.
Your personality: cheerful but meticulous, you love catching bugs and you take pride in your work.
You speak casually like a colleague (not corporate-speak), use short sentences, and occasionally crack a dry joke about software quality.
You are always helpful: if the user asks a vague question, you do your best with what you know rather than refusing.

You have deep knowledge of the websites you've tested. When answering questions, draw on your site knowledge and learnings from past sessions.
If you don't know something, say so honestly — but suggest how you could find out (e.g. "I haven't explored that page yet — want me to learn it?").

You can also give QA advice, testing strategies, and help plan test scenarios.
Today's date is ${new Date().toISOString().split("T")[0]}.`;

interface ChatMessage {
  role: "user" | "model";
  parts: { text: string }[];
}

let chatHistory: ChatMessage[] = [];

export function resetChatHistory(): void {
  chatHistory = [];
}

export function injectSessionContext(entries: SessionEntry[]): void {
  const recent = entries.slice(-20);
  for (const entry of recent) {
    chatHistory.push({
      role: entry.role === "user" ? "user" : "model",
      parts: [{ text: entry.content }],
    });
  }
}

export async function runChat(
  message: string,
  config: AppConfig,
  siteKnowledge: SiteKnowledge | null,
  learnings: Learning[],
  currentUrl: string,
): Promise<{ reply: string; inputTokens: number; outputTokens: number }> {
  const genAI = new GoogleGenerativeAI(config.apiKey);

  const knowledgeContext = buildSystemPrompt(siteKnowledge, learnings, {
    skipBasePrompt: true,
  });

  const systemText = [
    CHAT_IDENTITY,
    `The browser is currently on: ${currentUrl}`,
    knowledgeContext || "You haven't learned any sites yet.",
  ].join("\n\n");

  const model = genAI.getGenerativeModel({
    model: config.utilityModel.replace("google/", ""),
    systemInstruction: { role: "user", parts: [{ text: systemText }] },
  });

  const chat = model.startChat({
    history: chatHistory,
  });

  const streamResult = await chat.sendMessageStream(message);

  let fullReply = "";
  process.stdout.write("\n");
  for await (const chunk of streamResult.stream) {
    const text = chunk.text();
    if (text) {
      process.stdout.write(text);
      fullReply += text;
    }
  }
  process.stdout.write("\n");

  const response = await streamResult.response;

  chatHistory.push({
    role: "user",
    parts: [{ text: message }],
  });
  chatHistory.push({
    role: "model",
    parts: [{ text: fullReply }],
  });

  if (chatHistory.length > 40) {
    chatHistory = chatHistory.slice(-30);
  }

  const usage = response.usageMetadata;
  return {
    reply: fullReply,
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: usage?.candidatesTokenCount ?? 0,
  };
}
