import type { Bot, Context } from "grammy";
import { config } from "../config.js";
import { renderTelegramHtml } from "./render.js";
import { maskPotentialSecrets } from "../services/security.js";
import { ChatRateLimiter } from "../services/rateLimiter.js";
import { SqliteStore } from "../storage/sqlite.js";
import { LlmService } from "../services/llm.js";
import type { BotReply, CommandName, CommandRequest, StoredMessage } from "../types.js";

type BotContext = Context;

interface HandlerDeps {
  store: SqliteStore;
  llm: LlmService;
  limiter: ChatRateLimiter;
}

const heavyCommands = new Set<CommandName>(["summary", "plan"]);

function isCommand(text: string): boolean {
  return text.trimStart().startsWith("/");
}

function parseCommand(text: string): { command: CommandName; arg: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const [head, ...rest] = trimmed.split(/\s+/);
  if (!head) {
    return null;
  }
  const commandRaw = head.slice(1).split("@")[0]?.toLowerCase();
  const arg = rest.join(" ").trim();

  if (
    commandRaw === "idea" ||
    commandRaw === "critique" ||
    commandRaw === "plan" ||
    commandRaw === "summary" ||
    commandRaw === "decisions" ||
    commandRaw === "actions" ||
    commandRaw === "tldr" ||
    commandRaw === "open" ||
    commandRaw === "define"
  ) {
    return { command: commandRaw, arg };
  }

  return null;
}

function mentionsBot(text: string, botUsername: string): boolean {
  if (!botUsername) {
    return false;
  }

  return new RegExp(`(^|\\s)@${botUsername}(\\s|$)`, "i").test(text);
}

function stripBotMention(text: string, botUsername: string): string {
  if (!botUsername) {
    return text.trim();
  }

  return text.replace(new RegExp(`@${botUsername}`, "ig"), "").trim();
}

async function isAdmin(ctx: BotContext): Promise<boolean> {
  const from = ctx.from;
  const chat = ctx.chat;
  if (!from || !chat) {
    return false;
  }

  if (chat.type === "private") {
    return true;
  }

  const admins = await ctx.api.getChatAdministrators(chat.id);
  return admins.some((item) => item.user.id === from.id);
}

function isReplyToBot(ctx: BotContext, botId: number | undefined): boolean {
  if (!botId) {
    return false;
  }

  const reply = ctx.message?.reply_to_message;
  return Boolean(reply && reply.from && reply.from.id === botId);
}

function toStoredMessage(ctx: BotContext): StoredMessage | null {
  if (!ctx.chat || !ctx.message) {
    return null;
  }

  const sourceText =
    "text" in ctx.message
      ? ctx.message.text
      : "caption" in ctx.message
        ? (ctx.message.caption ?? "")
        : "";

  if (sourceText.trim().length === 0) {
    return null;
  }

  const fromName = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ").trim();

  return {
    ts: new Date((ctx.message.date ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    chatId: ctx.chat.id,
    messageId: ctx.message.message_id,
    fromId: ctx.from?.id ?? null,
    fromName: fromName || ctx.from?.username || "Unknown",
    text: maskPotentialSecrets(sourceText),
    replyToMessageId: ctx.message.reply_to_message?.message_id ?? null,
    threadId: "message_thread_id" in ctx.message ? (ctx.message.message_thread_id ?? null) : null,
    hasMedia: !("text" in ctx.message)
  };
}

function toReplyFromHistory(title: string, items: string[]): BotReply {
  return {
    title,
    sections: items.length > 0 ? [{ heading: "Items", bullets: items }] : [{ heading: "Items", bullets: ["Пока пусто"] }],
    decisions: [],
    actions: [],
    open_questions: [],
    risks: [],
    next_step: null
  };
}

async function replyHtml(ctx: BotContext, html: string): Promise<void> {
  const max = 3900;
  if (html.length <= max) {
    await ctx.reply(html, { parse_mode: "HTML" });
    return;
  }

  const lines = html.split("\n");
  let chunk = "";
  for (const line of lines) {
    const next = chunk.length === 0 ? line : `${chunk}\n${line}`;
    if (next.length <= max) {
      chunk = next;
      continue;
    }

    if (chunk.length > 0) {
      await ctx.reply(chunk, { parse_mode: "HTML" });
    }
    chunk = line;
  }

  if (chunk.length > 0) {
    await ctx.reply(chunk, { parse_mode: "HTML" });
  }
}

function updateChatState(oldState: string, reply: BotReply): string {
  const digest = [
    `${new Date().toISOString()} ${reply.title}`,
    ...reply.sections.flatMap((section) => section.bullets.map((bullet) => `- ${bullet}`)).slice(0, 10),
    ...reply.decisions.map((item) => `Decision: ${item.decision}`),
    ...reply.actions.map((item) => `Action: ${item.item}`)
  ].join("\n");

  const merged = [oldState, digest].filter((part) => part.length > 0).join("\n\n");
  const maxChars = 12_000;
  return merged.length > maxChars ? merged.slice(merged.length - maxChars) : merged;
}

function composeRequest(params: {
  command: CommandName;
  arg: string;
  summaryWindow: number;
  recentMessages: StoredMessage[];
  chatState: string;
  language: string;
}): CommandRequest {
  return {
    command: params.command,
    userInput: params.arg,
    summaryWindow: params.summaryWindow,
    recentMessages: params.recentMessages,
    chatState: params.chatState,
    language: params.language
  };
}

function parseSummaryWindow(arg: string): number {
  const maybe = Number.parseInt(arg, 10);
  if (!Number.isFinite(maybe) || maybe <= 0) {
    return config.defaultSummaryWindow;
  }
  return Math.min(maybe, config.maxContextMessages);
}

export function registerHandlers(bot: Bot<BotContext>, deps: HandlerDeps): void {
  const { store, llm, limiter } = deps;

  bot.command("start", async (ctx) => {
    await ctx.reply(
      [
        "Workspace Buddy готов.",
        "Команды: /idea /critique /plan /summary [N] /decisions /actions /tldr /open /define <term>",
        "Триггеры: @mention, команды, reply боту."
      ].join("\n")
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      [
        "Примеры:",
        "/idea Как улучшить онбординг?",
        "/critique Запускаем фичу без A/B",
        "/plan MVP для weekly-отчетов",
        "/summary 50",
        "/define north star metric"
      ].join("\n")
    );
  });

  bot.command("settings", async (ctx) => {
    if (!ctx.chat) {
      return;
    }

    const raw = ctx.message && "text" in ctx.message ? ctx.message.text : "";
    const parts = raw.split(/\s+/).slice(1);

    if (!(await isAdmin(ctx))) {
      await ctx.reply("Только админы чата могут менять настройки.");
      return;
    }

    if (parts.length < 2) {
      await ctx.reply("Использование: /settings mode <opt_in|ambient> или /settings language <ru|en>");
      return;
    }

    if (parts[0] === "mode") {
      const nextMode = parts[1] === "ambient" ? "ambient" : "opt_in";
      if (nextMode === "ambient" && !config.allowAmbientMode) {
        await ctx.reply("Ambient mode запрещён в конфиге (ALLOW_AMBIENT_MODE=false).");
        return;
      }
      store.setChatMode(ctx.chat.id, nextMode);
      await ctx.reply(`Режим чата обновлён: ${nextMode}`);
      return;
    }

    if (parts[0] === "language") {
      const nextLanguage = parts[1] ?? config.botLanguage;
      store.setChatLanguage(ctx.chat.id, nextLanguage);
      await ctx.reply(`Язык чата обновлён: ${nextLanguage}`);
      return;
    }

    await ctx.reply("Неизвестная настройка. Доступно: mode, language.");
  });

  bot.on("message", async (ctx) => {
    if (!ctx.chat || !ctx.message || ctx.from?.is_bot) {
      return;
    }

    const botId = bot.botInfo?.id;
    const botUsername = bot.botInfo?.username ?? "";

    store.upsertChat(ctx.chat.id, "title" in ctx.chat ? ctx.chat.title : undefined, ctx.chat.type);
    if (ctx.from) {
      const userPayload: {
        userId: number;
        username?: string;
        firstName?: string;
        lastName?: string;
      } = { userId: ctx.from.id };
      if (ctx.from.username) {
        userPayload.username = ctx.from.username;
      }
      if (ctx.from.first_name) {
        userPayload.firstName = ctx.from.first_name;
      }
      if (ctx.from.last_name) {
        userPayload.lastName = ctx.from.last_name;
      }
      store.upsertUser(userPayload);
    }

    const saved = toStoredMessage(ctx);
    if (saved) {
      store.saveMessage(saved);
    }

    const text = "text" in ctx.message ? ctx.message.text.trim() : "";
    if (text.length === 0) {
      return;
    }

    const settings = store.getChatSettings(ctx.chat.id, config.botLanguage);
    const command = parseCommand(text);
    const mentionTrigger = mentionsBot(text, botUsername);
    const replyTrigger = isReplyToBot(ctx, botId);

    const shouldRespond =
      Boolean(command) ||
      mentionTrigger ||
      replyTrigger ||
      (settings.mode === "ambient" && config.allowAmbientMode && text.toLowerCase().startsWith("бот:"));

    if (!shouldRespond) {
      return;
    }

    const routedCommand: CommandName = command?.command ?? "idea";
    const commandArg =
      command?.arg ??
      stripBotMention(text, botUsername).replace(/^бот:\s*/i, "").trim();

    if (routedCommand === "define" && commandArg.length === 0) {
      await ctx.reply("Использование: /define <термин>");
      return;
    }

    if (routedCommand === "decisions") {
      const history = store.getRecentDecisions(ctx.chat.id, 15);
      const rendered = toReplyFromHistory(
        "Decisions Log",
        history.map((row) => (row.rationale ? `${row.decision} — ${row.rationale}` : row.decision))
      );
      await replyHtml(ctx, renderTelegramHtml(rendered));
      return;
    }

    if (routedCommand === "actions") {
      const history = store.getOpenActionItems(ctx.chat.id, 20);
      const rendered = toReplyFromHistory(
        "Open Action Items",
        history.map((row) => {
          const owner = row.owner ? ` | owner: ${row.owner}` : "";
          const due = row.due ? ` | due: ${row.due}` : "";
          return `${row.item} | ${row.priority}${owner}${due}`;
        })
      );
      await replyHtml(ctx, renderTelegramHtml(rendered));
      return;
    }

    const limitCheck = limiter.allow(ctx.chat.id, heavyCommands.has(routedCommand));
    if (!limitCheck.ok) {
      await ctx.reply(limitCheck.reason);
      return;
    }

    await ctx.replyWithChatAction("typing");

    try {
      const summaryWindow = routedCommand === "summary" ? parseSummaryWindow(commandArg) : config.defaultSummaryWindow;
      const recentMessages = routedCommand === "summary" && ctx.message.reply_to_message
        ? store.getWindowAroundMessage(ctx.chat.id, ctx.message.reply_to_message.message_id, Math.floor(summaryWindow / 2))
        : store.getRecentMessages(ctx.chat.id, config.maxContextMessages);

      const chatState = store.getChatState(ctx.chat.id);
      const request = composeRequest({
        command: routedCommand,
        arg: commandArg,
        summaryWindow,
        recentMessages,
        chatState,
        language: settings.language
      });

      const reply = await llm.runCommand(request);
      const html = renderTelegramHtml(reply);
      await replyHtml(ctx, html);

      const newState = updateChatState(chatState, reply);
      store.upsertChatState(ctx.chat.id, newState);

      const isSummaryLike = routedCommand === "summary" || reply.decisions.length > 0 || reply.actions.length > 0;
      if (isSummaryLike) {
        const summaryId = store.saveSummary({
          chatId: ctx.chat.id,
          createdByUserId: ctx.from?.id ?? null,
          periodStart: recentMessages[0]?.ts ?? null,
          periodEnd: recentMessages.at(-1)?.ts ?? null,
          sourceMessageIds: recentMessages.map((item) => item.messageId),
          topic: reply.title,
          tldr: reply.sections.flatMap((section) => section.bullets).slice(0, 5).join("\n"),
          decisions: reply.decisions.map((item) => item.decision).join("\n"),
          actionItems: reply.actions.map((item) => item.item).join("\n"),
          openQuestions: reply.open_questions.join("\n"),
          risks: reply.risks.join("\n"),
          rawJson: JSON.stringify(reply)
        });

        if (reply.decisions.length > 0) {
          store.saveDecisions(ctx.chat.id, summaryId, reply.decisions);
        }

        if (reply.actions.length > 0) {
          store.saveActionItems(ctx.chat.id, summaryId, reply.actions);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      await ctx.reply(`Не удалось обработать запрос: ${message}`);
    }
  });

  bot.catch((error) => {
    console.error("Bot error", error.error);
  });
}
