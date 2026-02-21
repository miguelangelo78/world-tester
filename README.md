# World Tester

AI-powered QA tester agent that interacts with web applications in a real local browser.
Built with [Stagehand](https://stagehand.dev), Google Gemini, and Playwright Chromium.

World Tester behaves like a real QA engineer — it navigates websites, executes test steps, verifies outcomes, takes screenshots, learns from every interaction, and reports structured results. It remembers what it learns across sessions and gets faster over time.

## Quick Start (Local)

```bash
# Configure your environment
cp .env.example .env
# Edit .env and add your GOOGLE_GENERATIVE_AI_API_KEY and DATABASE_URL

# Install dependencies (also installs Chromium and generates Prisma client)
npm install

# Run (automatically syncs the database schema on first start)
npm start
```

Prerequisites: Node.js 22+, a PostgreSQL database.

## Quick Start (Docker)

Run the app inside Docker (connects to your host PostgreSQL):

```bash
# Configure your environment
cp .env.example .env
# Edit .env and add your GOOGLE_GENERATIVE_AI_API_KEY and DATABASE_URL

# Interactive CLI mode (build + run)
docker compose run --rm app

# With VNC for visual debugging (connect to localhost:5900)
VNC=true docker compose run --rm app
```

Screenshots are automatically saved to `./data/screenshots/` on the host via volume mount.

## Commands

All commands are entered in the interactive CLI. Prefix your input to select a mode, or just type naturally and the agent will figure it out.

| Prefix   | Mode    | Description                                       |
|----------|---------|---------------------------------------------------|
| `e:`     | Extract | Pull structured information from the current page |
| `a:`     | Act     | Perform a single action (click, type, toggle)     |
| `t:`     | Task    | Execute a complex, multi-step task via CUA        |
| `o:`     | Observe | Discover interactive elements on the page         |
| `s:`     | Search  | Search the web via browser navigation             |
| `?:`     | Ask     | Ask the agent about the current page              |
| `c:`     | Chat    | Conversational mode with full personality          |
| `g:`     | Goto    | Navigate to a URL                                 |
| `l:`     | Learn   | Crawl and catalog a website or specific section   |
| `test:`  | Test    | Run a structured QA test with plan, verify, report|
| _(none)_ | Auto    | Smart routing — agent decides the best approach   |

### Built-in commands

- `help` — Show available commands
- `cost` — Show session and billing cycle cost summary
- `history` — Show recent task history
- `knowledge` — Show stored site knowledge and learnings
- `quit` / `exit` — Close the browser and exit

### Examples

```
> g: https://myapp.com
> l
> t: go to account settings and change the display name to "Test User"
> test: Verify that changing a broker account's risk % persists after save
> c: what pages have you learned so far?
> a: click the dark mode toggle
> e: get all the form fields on this page
> ?: what issues have I found on this site before?
> s: stagehand browser automation docs
```

## Features

### Browser Automation (CUA)

Uses Google Gemini's Computer Use Agent mode via Stagehand for visual reasoning. The agent sees screenshots of the browser, reasons about UI layout, and performs actions by coordinate. Includes a 4-level retry mechanism for stuck clicks (Playwright locator, DOM event dispatch, Stagehand act, direct JS click).

### Chat Mode

Conversational interface powered by Gemini Flash. The agent has a QA tester personality — friendly, meticulous, and helpful. It can seamlessly switch from conversation to browser actions when you ask it to do something, then return to chat with a follow-up summary.

### Smart Routing (Auto Mode)

When you type without a prefix, the agent classifies your intent:
- Pure questions and conversation stay in chat
- Action requests are handed off to the appropriate browser mode
- Context from recent conversation is preserved, so "try again" works correctly

### Learning System

The agent builds knowledge in two layers:

- **Site Knowledge** (database): Structured data about each website — pages, forms, interactive elements, navigation paths, data displayed, common flows, tips, and known issues. Collected via the `l:` command or deep per-page analysis.

- **Learnings** (database): Reusable behavioral patterns organized by category:
  - **Navigation** — click trails and shortcuts to reach specific pages
  - **Recipes** — step-by-step instructions for tasks that succeeded
  - **Gotchas** — things that failed or behave unexpectedly
  - **General** — timing observations, SPA behavior, etc.

The agent learns passively from every command (background extraction after each task) and actively during `l:` learn sessions. Learnings use placeholders for dynamic content so they remain useful across users and sessions.

### QA Ticket Testing (`test:` command)

Structured end-to-end test execution:

1. **Plan** — Decomposes a ticket into ordered test steps with expected outcomes (via Gemini Flash, or accepts pre-structured JSON input)
2. **Execute** — Runs each step through the CUA browser agent
3. **Screenshot** — Captures before/after screenshots for every step (`data/screenshots/`)
4. **Verify** — AI-powered comparison of expected vs. actual page state
5. **Report** — Structured report saved to the database with per-step pass/fail, overall verdict, timing, and cost

```
> test: Verify that changing a broker account's risk % persists after save
```

Or with structured input:

```
> test: {"title": "Risk % update", "steps": [{"action": "Navigate to /account", "expected": "Account Settings page loads", "critical": true}, {"action": "Click Edit on Muay 2", "expected": "Edit modal opens", "critical": true}]}
```

Critical step failures abort remaining steps. Reports include a console summary and are persisted in the database.

### Cost Tracking

Every API call is tracked:
- **Per action** — tokens and cost shown after each command
- **Per session** — running total for the current session
- **Billing cycle** — persistent ledger in the database that accumulates across sessions and resets monthly

### Session Memory

Conversation history and task results persist across sessions in the database. When the agent starts, it loads the previous session's context so it remembers past interactions.

## Architecture

```
src/
├── index.ts                 # CLI loop and startup
├── db.ts                    # Prisma client singleton
├── config/
│   ├── index.ts             # Load .env config
│   └── types.ts             # AppConfig interface
├── cli/
│   ├── parser.ts            # Command prefix parsing
│   └── display.ts           # Formatted console output
├── browser/
│   └── stagehand.ts         # Chromium launch, Stagehand init, screenshots
├── agent/
│   ├── orchestrator.ts      # Central command dispatcher
│   ├── modes.ts             # extract, act, task, observe, goto, search, ask
│   ├── chat.ts              # Gemini Flash chat + smart routing
│   ├── learning.ts          # Site exploration and post-command learning
│   ├── system-prompt.ts     # Dynamic system prompt builder
│   ├── test-planner.ts      # Ticket decomposition into test steps
│   ├── test-runner.ts       # Plan → execute → verify → report loop
│   ├── test-report.ts       # Database report persistence + console summary
│   ├── test-types.ts        # TestPlan, TestStep, TestReport interfaces
│   └── verify.ts            # AI-powered expected vs actual verification
├── memory/
│   ├── manager.ts           # Prisma-backed persistence for all knowledge
│   └── types.ts             # SiteKnowledge, Learning, TaskRecord, etc.
└── cost/
    ├── tracker.ts           # Token counting, cost calculation, billing ledger
    └── pricing.ts           # Per-model token pricing

prisma/
└── schema.prisma            # Database schema (PostgreSQL)

docker/
└── entrypoint.sh            # Xvfb, optional VNC, DB migration, app start
```

### Data Storage

All structured data (site knowledge, learnings, task records, session history, billing, test reports) is stored in **PostgreSQL** via **Prisma ORM**.

Filesystem storage is used only for binary/large files:

```
data/
├── screenshots/             # Before/after screenshots from test runs
└── .browser-profile/        # Chromium user data (cookies, sessions)
```

## Configuration

Set these in `.env`:

| Variable                       | Required | Default | Description                           |
|--------------------------------|----------|---------|---------------------------------------|
| `GOOGLE_GENERATIVE_AI_API_KEY` | Yes      | —       | Google AI API key                     |
| `DATABASE_URL`                 | Yes      | See below | PostgreSQL connection string         |
| `HEADLESS`                     | No       | `false` | Run browser in headless mode          |
| `TARGET_URL`                   | No       | —       | Auto-navigate to this URL on start    |
| `VNC`                          | No       | `false` | Start VNC server in Docker (port 5900)|

Default `DATABASE_URL`: `postgresql://worldtester:worldtester@localhost:5432/worldtester`

## Docker

### Services

| Service | Image | Description |
|---------|-------|-------------|
| `db`    | `postgres:16-alpine` | PostgreSQL database |
| `app`   | Custom (Dockerfile) | World Tester with Chromium + Xvfb |

### Volume Mounts

- `./data/screenshots` → `/app/data/screenshots` — Screenshots accessible from host
- `./data/.browser-profile` → `/app/data/.browser-profile` — Browser session persistence
- `pgdata` (named volume) — PostgreSQL data persistence

### Running without Docker

You can still run locally without Docker. Just:
1. Have a PostgreSQL instance running (or use `docker compose up db -d` for just the database)
2. Set `DATABASE_URL` in `.env`
3. Run `npm run db:push` to sync the schema
4. Run `npm start`

## Tech Stack

- **[Stagehand](https://stagehand.dev)** — AI browser automation framework (CUA mode for visual reasoning, act/extract/observe primitives)
- **Google Gemini** — `gemini-2.5-computer-use-preview-10-2025` for browser automation, `gemini-2.5-flash` for chat and planning
- **Playwright Chromium** — Local browser with stealth flags, custom launch bypassing chrome-launcher for WSL2 compatibility
- **Node.js + TypeScript** — Runtime and language, executed via `tsx`
- **PostgreSQL + Prisma ORM** — All structured data persisted in Postgres via Prisma
- **Docker + Docker Compose** — Containerized execution with Xvfb and optional VNC

### Cost Principle

Everything is free and open-source except the AI model API. No Browserbase, no paid search APIs (web search happens via in-browser Google navigation), no paid npm packages.

## Future Plans

- Multi-model support (Anthropic, OpenAI)
- Slack and platform integrations
- Voice input/output
- HTML/Markdown test report export
