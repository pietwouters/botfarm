import dotenv from "dotenv";
import path from "node:path";

const cwdEnvPath = path.resolve(process.cwd(), ".env");
const parentEnvPath = path.resolve(process.cwd(), "..", ".env");

dotenv.config({ path: parentEnvPath });
dotenv.config({ path: cwdEnvPath });

function mustGet(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

function asInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function asBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

export const config = {
  telegramToken: mustGet("TELEGRAM_BOT_TOKEN"),
  openAiApiKey: mustGet("OPENAI_API_KEY"),
  openAiModel: process.env.OPENAI_MODEL ?? "gpt-5.2",
  dbPath: path.resolve(process.cwd(), process.env.DB_PATH ?? "./data/workspace-buddy.db"),
  ringBufferSize: asInt("RING_BUFFER_SIZE", 300),
  defaultSummaryWindow: asInt("DEFAULT_SUMMARY_WINDOW", 50),
  maxContextMessages: asInt("MAX_CONTEXT_MESSAGES", 80),
  chatRequestsPerHour: asInt("CHAT_REQUESTS_PER_HOUR", 20),
  heavyCommandsPer10Min: asInt("HEAVY_COMMANDS_PER_10_MIN", 3),
  botLanguage: process.env.BOT_LANGUAGE ?? "ru",
  allowAmbientMode: asBool("ALLOW_AMBIENT_MODE", false)
};
