import { Bot } from "grammy";
import { config } from "./config.js";
import { registerHandlers } from "./bot/handlers.js";
import { SqliteStore } from "./storage/sqlite.js";
import { LlmService } from "./services/llm.js";
import { ChatRateLimiter } from "./services/rateLimiter.js";

async function main(): Promise<void> {
  const store = new SqliteStore(config.dbPath, config.ringBufferSize, config.botLanguage);
  const llm = new LlmService(config.openAiApiKey, config.openAiModel);
  const limiter = new ChatRateLimiter(config.chatRequestsPerHour, config.heavyCommandsPer10Min);

  const bot = new Bot(config.telegramToken);
  registerHandlers(bot, { store, llm, limiter });

  await bot.init();

  const botName = bot.botInfo?.username ?? "unknown";
  console.log(`workspace-buddy started as @${botName}`);

  bot.start({
    onStart: () => {
      console.log("Polling started.");
    }
  });

  const shutdown = () => {
    console.log("Shutting down...");
    bot.stop();
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("Failed to start workspace-buddy", error);
  process.exit(1);
});
