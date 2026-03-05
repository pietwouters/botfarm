import type { BotAction, BotDecision, BotReply } from "../types.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderDecisions(decisions: BotDecision[]): string[] {
  if (decisions.length === 0) {
    return [];
  }

  const lines = ["<b>Decisions</b>"];
  for (const row of decisions) {
    const item = escapeHtml(row.decision);
    const rationale = row.rationale ? ` — ${escapeHtml(row.rationale)}` : "";
    lines.push(`• ${item}${rationale}`);
  }
  return lines;
}

function renderActions(actions: BotAction[]): string[] {
  if (actions.length === 0) {
    return [];
  }

  const lines = ["<b>Action Items</b>"];
  for (const row of actions) {
    const owner = row.owner ? ` | owner: ${escapeHtml(row.owner)}` : "";
    const due = row.due ? ` | due: ${escapeHtml(row.due)}` : "";
    lines.push(`• ${escapeHtml(row.item)} | ${row.priority}${owner}${due}`);
  }
  return lines;
}

function renderList(title: string, values: string[]): string[] {
  if (values.length === 0) {
    return [];
  }

  return [
    `<b>${escapeHtml(title)}</b>`,
    ...values.map((value) => `• ${escapeHtml(value)}`)
  ];
}

export function renderTelegramHtml(reply: BotReply): string {
  const lines: string[] = [];
  lines.push(`<b>${escapeHtml(reply.title)}</b>`);

  for (const section of reply.sections) {
    lines.push(`<b>${escapeHtml(section.heading)}</b>`);
    for (const bullet of section.bullets) {
      lines.push(`• ${escapeHtml(bullet)}`);
    }
  }

  lines.push(...renderDecisions(reply.decisions));
  lines.push(...renderActions(reply.actions));
  lines.push(...renderList("Open Questions", reply.open_questions));
  lines.push(...renderList("Risks", reply.risks));

  if (reply.next_step) {
    lines.push("<b>Next Step</b>");
    lines.push(`• ${escapeHtml(reply.next_step)}`);
  }

  return lines.join("\n");
}
