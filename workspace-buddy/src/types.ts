export type CommandName =
  | "idea"
  | "critique"
  | "plan"
  | "summary"
  | "decisions"
  | "actions"
  | "tldr"
  | "open"
  | "define";

export type Priority = "low" | "medium" | "high";
export type ActionStatus = "open" | "doing" | "done" | "cancelled";
export type DecisionStatus = "active" | "superseded" | "revoked";

export interface BotSection {
  heading: string;
  bullets: string[];
}

export interface BotDecision {
  decision: string;
  rationale: string | null;
  owner: string | null;
  status: DecisionStatus;
}

export interface BotAction {
  item: string;
  owner: string | null;
  priority: Priority;
  due: string | null;
  status: ActionStatus;
}

export interface BotReply {
  title: string;
  sections: BotSection[];
  decisions: BotDecision[];
  actions: BotAction[];
  open_questions: string[];
  risks: string[];
  next_step: string | null;
}

export interface StoredMessage {
  ts: string;
  chatId: number;
  messageId: number;
  fromId: number | null;
  fromName: string;
  text: string;
  replyToMessageId: number | null;
  threadId: number | null;
  hasMedia: boolean;
}

export interface ChatSettings {
  mode: "opt_in" | "ambient";
  language: string;
}

export interface CommandRequest {
  command: CommandName;
  userInput: string;
  summaryWindow: number;
  recentMessages: StoredMessage[];
  chatState: string;
  language: string;
}
