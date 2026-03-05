# workspace-buddy

Telegram bot for work chat collaboration: idea expansion, critique, planning, and summaries using OpenAI Responses API (`gpt-5.2`).

## Features

- Trigger policy for work chats:
  - command (`/idea`, `/summary`, ...)
  - mention (`@your_bot ...`)
  - reply to bot message
- Commands:
  - `/idea <text>`
  - `/critique <text>`
  - `/plan <text>`
  - `/summary [N]`
  - `/decisions`
  - `/actions`
  - `/tldr`
  - `/open`
  - `/define <term>`
  - `/settings mode <opt_in|ambient>`
  - `/settings language <ru|en>`
- Local persistence with SQLite:
  - ring buffer of recent messages by chat
  - compact chat state
  - summaries, decisions, action items
- Cost controls:
  - per-chat hourly limits
  - heavy command limits (`/summary`, `/plan`)

## Stack

- Node.js 20+
- TypeScript
- [grammY](https://grammy.dev/)
- [OpenAI Node SDK](https://www.npmjs.com/package/openai)
- SQLite (`better-sqlite3`)

## Setup

1. Create bot with BotFather and get `TELEGRAM_BOT_TOKEN`.
2. Get `OPENAI_API_KEY` from OpenAI platform.
3. Configure env file at repo root.

```bash
cd /Users/yurykorotovskikh/repos/unimetrics/botfarm
cp .env.example .env
```

4. Install and run from root workspace.

```bash
pnpm install
pnpm dev
```

## Environment

See `/Users/yurykorotovskikh/repos/unimetrics/botfarm/.env.example`.

Most important values:

- `TELEGRAM_BOT_TOKEN`
- `OPENAI_API_KEY`
- `OPENAI_MODEL=gpt-5.2`
- `ALLOW_AMBIENT_MODE=false` (recommended default)

## Privacy Mode Guidance

For safer start, keep Telegram group privacy mode enabled (opt-in behavior). The bot will still work through commands/mentions/replies.

## Notes

- `/decisions` and `/actions` read from saved protocol data.
- `/summary` writes summary + extracted decisions/actions into SQLite.
- Potential secrets in input are masked before storage/prompting.
