import type { CommandName, CommandRequest, StoredMessage } from "../types.js";

const schemaDescription = `{
  "title": "string",
  "sections": [{ "heading": "string", "bullets": ["string"] }],
  "decisions": [{ "decision": "string", "rationale": "string|null", "owner": "string|null", "status": "active|superseded|revoked" }],
  "actions": [{ "item": "string", "owner": "string|null", "priority": "low|medium|high", "due": "YYYY-MM-DD|null", "status": "open|doing|done|cancelled" }],
  "open_questions": ["string"],
  "risks": ["string"],
  "next_step": "string|null"
}`;

function formatMessages(messages: StoredMessage[]): string {
  if (messages.length === 0) {
    return "(no messages)";
  }

  return messages
    .map((item) => {
      const name = item.fromName.trim().length > 0 ? item.fromName : `user:${item.fromId ?? "unknown"}`;
      return `[${item.messageId}] ${name}: ${item.text}`;
    })
    .join("\n");
}

const commandGuides: Record<CommandName, string> = {
  idea: `Command: /idea\nNeed: reformulate idea in 1-2 lines, 5-8 clarifying questions, 2-3 solution variants with tradeoffs, risks/unknowns, one concrete next step.`,
  critique: `Command: /critique\nNeed: 8-12 strong objections, metric pitfalls, 3 fast experiments, one improved variant.`,
  plan: `Command: /plan\nNeed: epics -> tasks, dependencies, parallelizable work, clear MVP scope, risks/monitoring, action items.`,
  summary: `Command: /summary\nNeed: TL;DR up to 5 bullets, decisions, action items, open questions, blockers/risks, one next step.`,
  decisions: `Command: /decisions\nNeed: extract concrete decisions only. If none, keep decisions empty and explain what is missing in sections.`,
  actions: `Command: /actions\nNeed: extract practical action items with owner when possible and priority.`,
  tldr: `Command: /tldr\nNeed: 3-5 bullets with only the key points.`,
  open: `Command: /open\nNeed: unresolved questions blocking progress.`,
  define: `Command: /define\nNeed: short definition plus one relevant example in this project context.`
};

export function buildSystemPrompt(language: string): string {
  return [
    "You are an AI teammate in a work chat.",
    `Respond in language: ${language}.`,
    "Always separate chat facts from assumptions.",
    "Be concise and structured by default.",
    "If user request is vague, include clarifying questions.",
    "If secrets appear in text, warn and avoid repeating them.",
    "Output strictly valid JSON and nothing else.",
    `JSON schema: ${schemaDescription}`
  ].join("\n");
}

export function buildUserPrompt(input: CommandRequest): string {
  const recent = formatMessages(input.recentMessages);
  const base = [
    commandGuides[input.command],
    `Chat compact state:\n${input.chatState || "(empty)"}`,
    `Recent messages:\n${recent}`
  ];

  if (input.command === "summary") {
    base.push(`Summary window N=${input.summaryWindow}`);
  }

  base.push(`User input:\n${input.userInput || "(empty)"}`);
  base.push("Return JSON only.");

  return base.join("\n\n");
}
