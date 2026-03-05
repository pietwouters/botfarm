import OpenAI from "openai";
import type { BotAction, BotDecision, BotReply, CommandRequest } from "../types.js";
import { buildSystemPrompt, buildUserPrompt } from "./prompting.js";

function normalizeDecisionStatus(value: unknown): BotDecision["status"] {
  if (value === "superseded" || value === "revoked") {
    return value;
  }
  return "active";
}

function normalizePriority(value: unknown): BotAction["priority"] {
  if (value === "low" || value === "high") {
    return value;
  }
  return "medium";
}

function normalizeActionStatus(value: unknown): BotAction["status"] {
  if (value === "doing" || value === "done" || value === "cancelled") {
    return value;
  }
  return "open";
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item) => typeof item === "string");
}

function extractText(response: unknown): string {
  if (!response || typeof response !== "object") {
    return "";
  }

  const candidate = response as { output_text?: unknown; output?: unknown[] };
  if (typeof candidate.output_text === "string") {
    return candidate.output_text;
  }

  if (!Array.isArray(candidate.output)) {
    return "";
  }

  const chunks: string[] = [];
  for (const item of candidate.output) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      continue;
    }

    for (const part of content) {
      if (!part || typeof part !== "object") {
        continue;
      }

      const text = (part as { text?: unknown }).text;
      if (typeof text === "string") {
        chunks.push(text);
      }
    }
  }

  return chunks.join("\n").trim();
}

function extractJsonCandidate(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return trimmed.slice(first, last + 1);
  }

  return "{}";
}

function normalizeReply(value: unknown): BotReply {
  const obj = (value ?? {}) as Record<string, unknown>;

  const sectionsRaw = Array.isArray(obj.sections) ? obj.sections : [];
  const sections = sectionsRaw
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const row = item as Record<string, unknown>;
      return {
        heading: asString(row.heading, "Section"),
        bullets: asStringArray(row.bullets)
      };
    });

  const decisionsRaw = Array.isArray(obj.decisions) ? obj.decisions : [];
  const decisions = decisionsRaw
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const row = item as Record<string, unknown>;
      return {
        decision: asString(row.decision),
        rationale: row.rationale === null ? null : asNullableString(row.rationale),
        owner: row.owner === null ? null : asNullableString(row.owner),
        status: normalizeDecisionStatus(row.status)
      };
    })
    .filter((item) => item.decision.length > 0);

  const actionsRaw = Array.isArray(obj.actions) ? obj.actions : [];
  const actions = actionsRaw
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const row = item as Record<string, unknown>;
      return {
        item: asString(row.item),
        owner: row.owner === null ? null : asNullableString(row.owner),
        priority: normalizePriority(row.priority),
        due: row.due === null ? null : asNullableString(row.due),
        status: normalizeActionStatus(row.status)
      };
    })
    .filter((item) => item.item.length > 0);

  return {
    title: asString(obj.title, "Workspace Buddy"),
    sections,
    decisions,
    actions,
    open_questions: asStringArray(obj.open_questions),
    risks: asStringArray(obj.risks),
    next_step: obj.next_step === null ? null : asNullableString(obj.next_step)
  };
}

export class LlmService {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async runCommand(input: CommandRequest): Promise<BotReply> {
    const response = await this.client.responses.create({
      model: this.model,
      input: [
        {
          role: "system",
          content: buildSystemPrompt(input.language)
        },
        {
          role: "user",
          content: buildUserPrompt(input)
        }
      ]
    });

    const raw = extractText(response);
    const candidate = extractJsonCandidate(raw);
    const parsed = JSON.parse(candidate) as unknown;
    return normalizeReply(parsed);
  }
}
