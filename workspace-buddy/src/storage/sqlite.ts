import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { BotAction, BotDecision, ChatSettings, StoredMessage } from "../types.js";

interface SummaryInput {
  chatId: number;
  createdByUserId: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  sourceMessageIds: number[];
  topic: string | null;
  tldr: string;
  decisions: string;
  actionItems: string;
  openQuestions: string;
  risks: string;
  rawJson: string;
}

export class SqliteStore {
  private readonly db: Database.Database;
  private readonly ringBufferSize: number;
  private readonly defaultLanguage: string;

  constructor(dbPath: string, ringBufferSize: number, defaultLanguage: string) {
    const parentDir = path.dirname(dbPath);
    fs.mkdirSync(parentDir, { recursive: true });

    this.db = new Database(dbPath);
    this.ringBufferSize = ringBufferSize;
    this.defaultLanguage = defaultLanguage;
    this.db.pragma("journal_mode = WAL");
    this.bootstrap();
  }

  private bootstrap(): void {
    this.db.exec(`
      create table if not exists tg_chats (
        chat_id integer primary key,
        title text,
        type text not null,
        created_at text not null,
        updated_at text not null
      );

      create table if not exists tg_users (
        user_id integer primary key,
        username text,
        first_name text,
        last_name text,
        updated_at text not null
      );

      create table if not exists messages (
        chat_id integer not null,
        message_id integer not null,
        ts text not null,
        from_id integer,
        from_name text not null,
        text text not null,
        reply_to_message_id integer,
        thread_id integer,
        has_media integer not null default 0,
        primary key(chat_id, message_id)
      );

      create index if not exists messages_chat_ts_idx
      on messages(chat_id, ts desc, message_id desc);

      create table if not exists chat_state (
        chat_id integer primary key,
        state_text text not null,
        updated_at text not null
      );

      create table if not exists chat_settings (
        chat_id integer primary key,
        mode text not null default 'opt_in',
        language text not null default 'ru',
        updated_at text not null
      );

      create table if not exists tg_summaries (
        id integer primary key autoincrement,
        chat_id integer not null,
        created_by_user_id integer,
        period_start text,
        period_end text,
        source_message_ids text,
        topic text,
        tldr text not null,
        decisions text,
        action_items text,
        open_questions text,
        risks text,
        raw_json text not null,
        created_at text not null
      );

      create index if not exists tg_summaries_chat_created_idx
      on tg_summaries(chat_id, created_at desc);

      create table if not exists tg_decisions (
        id integer primary key autoincrement,
        chat_id integer not null,
        summary_id integer,
        decided_at text not null,
        decision text not null,
        rationale text,
        owner text,
        status text not null default 'active'
      );

      create index if not exists tg_decisions_chat_time_idx
      on tg_decisions(chat_id, decided_at desc);

      create table if not exists tg_action_items (
        id integer primary key autoincrement,
        chat_id integer not null,
        summary_id integer,
        created_at text not null,
        item text not null,
        owner text,
        priority text not null default 'medium',
        due_date text,
        status text not null default 'open'
      );

      create index if not exists tg_actions_chat_status_idx
      on tg_action_items(chat_id, status, created_at desc);
    `);
  }

  upsertChat(chatId: number, title: string | undefined, type: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
          insert into tg_chats (chat_id, title, type, created_at, updated_at)
          values (@chatId, @title, @type, @now, @now)
          on conflict(chat_id)
          do update set title = excluded.title, type = excluded.type, updated_at = excluded.updated_at
        `
      )
      .run({ chatId, title: title ?? null, type, now });

    this.db
      .prepare(
        `
          insert into chat_settings (chat_id, mode, language, updated_at)
          values (@chatId, 'opt_in', @language, @now)
          on conflict(chat_id) do nothing
        `
      )
      .run({ chatId, language: this.defaultLanguage, now });
  }

  upsertUser(user: {
    userId: number;
    username?: string;
    firstName?: string;
    lastName?: string;
  }): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
          insert into tg_users (user_id, username, first_name, last_name, updated_at)
          values (@userId, @username, @firstName, @lastName, @now)
          on conflict(user_id)
          do update set
            username = excluded.username,
            first_name = excluded.first_name,
            last_name = excluded.last_name,
            updated_at = excluded.updated_at
        `
      )
      .run({
        userId: user.userId,
        username: user.username ?? null,
        firstName: user.firstName ?? null,
        lastName: user.lastName ?? null,
        now
      });
  }

  saveMessage(message: StoredMessage): void {
    this.db
      .prepare(
        `
          insert into messages
          (chat_id, message_id, ts, from_id, from_name, text, reply_to_message_id, thread_id, has_media)
          values
          (@chatId, @messageId, @ts, @fromId, @fromName, @text, @replyToMessageId, @threadId, @hasMedia)
          on conflict(chat_id, message_id)
          do update set
            ts = excluded.ts,
            from_id = excluded.from_id,
            from_name = excluded.from_name,
            text = excluded.text,
            reply_to_message_id = excluded.reply_to_message_id,
            thread_id = excluded.thread_id,
            has_media = excluded.has_media
        `
      )
      .run({
        ...message,
        hasMedia: message.hasMedia ? 1 : 0
      });

    this.trimMessages(message.chatId);
  }

  private trimMessages(chatId: number): void {
    this.db
      .prepare(
        `
          delete from messages
          where chat_id = ?
            and message_id not in (
              select message_id
              from messages
              where chat_id = ?
              order by ts desc, message_id desc
              limit ?
            )
        `
      )
      .run(chatId, chatId, this.ringBufferSize);
  }

  getRecentMessages(chatId: number, limit: number): StoredMessage[] {
    const rows = this.db
      .prepare(
        `
          select chat_id as chatId, message_id as messageId, ts, from_id as fromId,
                 from_name as fromName, text, reply_to_message_id as replyToMessageId,
                 thread_id as threadId, has_media as hasMedia
          from messages
          where chat_id = ?
          order by ts desc, message_id desc
          limit ?
        `
      )
      .all(chatId, limit) as StoredMessage[];

    return rows
      .map((row) => ({ ...row, hasMedia: Boolean((row as unknown as { hasMedia: number }).hasMedia) }))
      .reverse();
  }

  getWindowAroundMessage(chatId: number, messageId: number, side: number): StoredMessage[] {
    const fromBefore = this.db
      .prepare(
        `
          select chat_id as chatId, message_id as messageId, ts, from_id as fromId,
                 from_name as fromName, text, reply_to_message_id as replyToMessageId,
                 thread_id as threadId, has_media as hasMedia
          from messages
          where chat_id = ? and message_id <= ?
          order by message_id desc
          limit ?
        `
      )
      .all(chatId, messageId, side + 1) as StoredMessage[];

    const fromAfter = this.db
      .prepare(
        `
          select chat_id as chatId, message_id as messageId, ts, from_id as fromId,
                 from_name as fromName, text, reply_to_message_id as replyToMessageId,
                 thread_id as threadId, has_media as hasMedia
          from messages
          where chat_id = ? and message_id > ?
          order by message_id asc
          limit ?
        `
      )
      .all(chatId, messageId, side) as StoredMessage[];

    const merged = [...fromBefore.reverse(), ...fromAfter];
    return merged.map((row) => ({
      ...row,
      hasMedia: Boolean((row as unknown as { hasMedia: number }).hasMedia)
    }));
  }

  getChatState(chatId: number): string {
    const row = this.db
      .prepare(`select state_text as stateText from chat_state where chat_id = ?`)
      .get(chatId) as { stateText: string } | undefined;
    return row?.stateText ?? "";
  }

  upsertChatState(chatId: number, stateText: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
          insert into chat_state(chat_id, state_text, updated_at)
          values (?, ?, ?)
          on conflict(chat_id)
          do update set state_text = excluded.state_text, updated_at = excluded.updated_at
        `
      )
      .run(chatId, stateText, now);
  }

  getChatSettings(chatId: number, fallbackLanguage: string): ChatSettings {
    const row = this.db
      .prepare(`select mode, language from chat_settings where chat_id = ?`)
      .get(chatId) as { mode: string; language: string } | undefined;

    return {
      mode: row?.mode === "ambient" ? "ambient" : "opt_in",
      language: row?.language ?? fallbackLanguage
    };
  }

  setChatMode(chatId: number, mode: ChatSettings["mode"]): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
          insert into chat_settings(chat_id, mode, language, updated_at)
          values(?, ?, ?, ?)
          on conflict(chat_id)
          do update set mode = excluded.mode, updated_at = excluded.updated_at
        `
      )
      .run(chatId, mode, this.defaultLanguage, now);
  }

  setChatLanguage(chatId: number, language: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
          insert into chat_settings(chat_id, mode, language, updated_at)
          values(?, 'opt_in', ?, ?)
          on conflict(chat_id)
          do update set language = excluded.language, updated_at = excluded.updated_at
        `
      )
      .run(chatId, language, now);
  }

  saveSummary(input: SummaryInput): number {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `
          insert into tg_summaries
          (chat_id, created_by_user_id, period_start, period_end, source_message_ids, topic, tldr,
           decisions, action_items, open_questions, risks, raw_json, created_at)
          values
          (@chatId, @createdByUserId, @periodStart, @periodEnd, @sourceMessageIds, @topic, @tldr,
           @decisions, @actionItems, @openQuestions, @risks, @rawJson, @createdAt)
        `
      )
      .run({
        ...input,
        sourceMessageIds: JSON.stringify(input.sourceMessageIds),
        createdAt: now
      });

    return Number(result.lastInsertRowid);
  }

  saveDecisions(chatId: number, summaryId: number | null, decisions: BotDecision[]): void {
    const stmt = this.db.prepare(
      `
        insert into tg_decisions(chat_id, summary_id, decided_at, decision, rationale, owner, status)
        values (@chatId, @summaryId, @decidedAt, @decision, @rationale, @owner, @status)
      `
    );

    const now = new Date().toISOString();
    const tx = this.db.transaction((items: BotDecision[]) => {
      for (const item of items) {
        stmt.run({
          chatId,
          summaryId,
          decidedAt: now,
          decision: item.decision,
          rationale: item.rationale,
          owner: item.owner,
          status: item.status
        });
      }
    });

    tx(decisions);
  }

  saveActionItems(chatId: number, summaryId: number | null, actions: BotAction[]): void {
    const stmt = this.db.prepare(
      `
        insert into tg_action_items
        (chat_id, summary_id, created_at, item, owner, priority, due_date, status)
        values
        (@chatId, @summaryId, @createdAt, @item, @owner, @priority, @dueDate, @status)
      `
    );

    const now = new Date().toISOString();
    const tx = this.db.transaction((items: BotAction[]) => {
      for (const item of items) {
        stmt.run({
          chatId,
          summaryId,
          createdAt: now,
          item: item.item,
          owner: item.owner,
          priority: item.priority,
          dueDate: item.due,
          status: item.status
        });
      }
    });

    tx(actions);
  }

  getRecentDecisions(chatId: number, limit = 15): BotDecision[] {
    const rows = this.db
      .prepare(
        `
          select decision, rationale, owner, status
          from tg_decisions
          where chat_id = ?
          order by decided_at desc
          limit ?
        `
      )
      .all(chatId, limit) as BotDecision[];

    return rows;
  }

  getOpenActionItems(chatId: number, limit = 20): BotAction[] {
    const rows = this.db
      .prepare(
        `
          select item, owner, priority, due_date as due, status
          from tg_action_items
          where chat_id = ? and status in ('open', 'doing')
          order by created_at desc
          limit ?
        `
      )
      .all(chatId, limit) as BotAction[];

    return rows;
  }
}
