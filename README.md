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
npm run release:interactive

# With VNC for visual debugging
npm run release:interactive:vnc
# Then in another terminal:
npm run vnc
```

### npm scripts

| Script | Description |
|--------|-------------|
| `npm start` | Run locally (auto-syncs DB schema on first start) |
| `npm run release` | Docker: background mode |
| `npm run release:vnc` | Docker: background + VNC |
| `npm run release:interactive` | Docker: interactive CLI |
| `npm run release:interactive:vnc` | Docker: interactive CLI + VNC |
| `npm run vnc` | Connect to VNC viewer (install: `sudo apt install tigervnc-viewer`) |
| `npm run release:logs` | Tail Docker container logs |
| `npm run release:down` | Stop Docker containers |

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

### Browser targeting

Target a specific browser (and optionally a specific tab) by prefixing with `@name` or `@name:tab`:

```
@userA t: go to account settings          # run on browser "userA", active tab
@userA:1 e: extract the page title        # run on browser "userA", tab index 1
@admin:settings t: change the theme       # run on "admin" browser, tab matching "settings" in URL
```

### Browser management commands

| Command | Description |
|---------|-------------|
| `browser` | List all browsers with their tabs |
| `browser:spawn <name> [--isolated]` | Launch a new browser instance |
| `browser:kill <name>` | Close a browser instance |
| `browser:switch <name>` | Switch the active browser |

### Tab management commands

| Command | Description |
|---------|-------------|
| `tab` | List tabs in the active browser |
| `tab:new [url]` | Open a new tab (optionally navigate to a URL) |
| `tab:switch <index or url>` | Switch active tab by index or URL fragment |
| `tab:close [index]` | Close a tab (defaults to active tab) |

### Built-in commands

- `help` — Show available commands
- `cost` — Show session and billing cycle cost summary
- `history` — Show recent task history
- `knowledge` — Show stored site knowledge and learnings
- `quit` / `exit` — Close all browsers and exit

### Examples

```
# Basic usage
> g: https://myapp.com
> l
> t: go to account settings and change the display name to "Test User"
> test: Verify that changing a broker account's risk % persists after save
> c: what pages have you learned so far?
> a: click the dark mode toggle
> e: get all the form fields on this page

# Multi-browser: test that admin changes are visible to a regular user
> browser:spawn admin --isolated
> @admin g: https://myapp.com/admin
> @admin t: create a new user called "TestUser" with role "viewer"
> browser:spawn viewer --isolated
> @viewer g: https://myapp.com/login
> @viewer t: log in as TestUser
> @viewer e: extract the user's role from the profile page

# Multi-tab: compare two pages side by side
> tab:new https://myapp.com/settings
> tab:new https://myapp.com/profile
> @main:0 e: extract the current theme from settings
> @main:1 e: extract the display name from profile

# Multi-browser QA test (structured)
> test: {"title": "Cross-user visibility", "steps": [
    {"action": "In browser admin, create project X", "expected": "Project created", "critical": true, "browser": "admin"},
    {"action": "In browser viewer, navigate to projects", "expected": "Project X is visible", "critical": true, "browser": "viewer"}
  ]}
```

## Features

### Multi-Browser & Multi-Tab

The agent can spawn and manage multiple independent browser instances, each with its own session and profile. Browsers can be isolated (separate cookies/login) or shared.

- **Spawn** browsers on the fly: `browser:spawn userB --isolated`
- **Target** any browser from any command: `@userB t: log in as admin`
- **Target a specific tab** within a browser: `@userB:1 e: extract data`
- **Tabs** within each browser: open, switch, close independently
- **Smart routing** — the chat agent can also decide to spawn or switch browsers automatically when the task requires it (e.g., "open a new browser as userB")
- **Test runner** supports per-step browser targeting for cross-browser QA scenarios

This enables testing scenarios like:
- Verify that changes by user A are visible to user B
- Test OAuth popup flows across tabs
- Compare logged-in vs. logged-out views simultaneously

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

Multi-browser test steps can target specific browsers:

```
> test: {"title": "Cross-user visibility", "steps": [
    {"action": "Create project X", "expected": "Project created", "critical": true, "browser": "admin"},
    {"action": "Check projects list", "expected": "Project X visible", "critical": true, "browser": "viewer"}
  ]}
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
├── db.ts                    # Prisma client singleton + auto-schema sync
├── config/
│   ├── index.ts             # Load .env config
│   └── types.ts             # AppConfig interface
├── cli/
│   ├── parser.ts            # Command prefix parsing
│   └── display.ts           # Formatted console output
├── browser/
│   ├── pool.ts              # BrowserPool + BrowserInstance (multi-browser/tab management)
│   └── stagehand.ts         # Chrome launch helpers, Stagehand logger, pool-backed compat layer
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
└── entrypoint.sh            # Xvfb, optional VNC, localhost rewriting, app start
```

### Data Storage

All structured data (site knowledge, learnings, task records, session history, billing, test reports) is stored in **PostgreSQL** via **Prisma ORM**.

Filesystem storage is used only for binary/large files:

```
data/
├── screenshots/             # Before/after screenshots from test runs
├── .browser-profile/        # Chromium user data for the default "main" browser
├── .browser-profile-<name>/ # Isolated Chromium profiles for additional browser instances
└── .browser-profile-docker/ # Chromium user data for Docker runs (separate to avoid lock conflicts)
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

Default `DATABASE_URL`: `postgresql://postgres:postgres@localhost:5432/worldtester`

## Docker

The Docker setup runs the app with a headless Chromium browser inside a virtual display (Xvfb). VNC can be enabled for visual debugging.

### How it works

- The container connects to your **host PostgreSQL** — `localhost` and `127.0.0.1` in `DATABASE_URL` and `TARGET_URL` are automatically rewritten to `host.docker.internal` by the entrypoint
- Screenshots are volume-mounted to `./data/screenshots/` for host access
- Browser profile is stored in `./data/.browser-profile-docker/` (separate from local runs to avoid lock conflicts)
- Stale Chromium lock files are cleaned automatically on container start

### VNC

To see the browser visually while running in Docker:

1. Start with VNC: `npm run release:interactive:vnc` (or `npm run release:vnc` for background)
2. Connect: `npm run vnc` (requires `tigervnc-viewer` — install with `sudo apt install tigervnc-viewer`)
3. On Windows/macOS: use any VNC client (e.g. RealVNC Viewer) and connect to `localhost:5900`

### Running without Docker

Just set `DATABASE_URL` in `.env` pointing to a PostgreSQL instance and run `npm start`. The app auto-syncs the database schema on startup.

## Tech Stack

- **[Stagehand](https://stagehand.dev)** — AI browser automation framework (CUA mode for visual reasoning, act/extract/observe primitives)
- **Google Gemini** — `gemini-2.5-computer-use-preview-10-2025` for browser automation, `gemini-2.5-flash` for chat and planning
- **Playwright Chromium** — Local browser with stealth flags, custom launch bypassing chrome-launcher for WSL2 compatibility
- **Node.js + TypeScript** — Runtime and language, executed via `tsx`
- **PostgreSQL + Prisma ORM** — All structured data persisted in Postgres via Prisma
- **Docker + Docker Compose** — Containerized execution with Xvfb and optional VNC

### Cost Principle

Everything is free and open-source except the AI model API. No Browserbase, no paid search APIs (web search happens via in-browser Google navigation), no paid npm packages.

## CLI Prompt

The prompt dynamically shows context:

```
[https://myapp.com/settings]              # single browser, single tab
> 

[main|https://myapp.com/settings (2 tabs)] # single browser, multiple tabs
> 

[admin|https://myapp.com/admin (3 tabs)]   # multiple browsers — shows active browser name
> 
```

## Future Plans

- Multi-model support (Anthropic, OpenAI)
- Slack and platform integrations
- Voice input/output
- HTML/Markdown test report export
