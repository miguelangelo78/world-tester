# World Tester

AI-powered QA tester agent that interacts with web applications in a real local browser.
Built with [Stagehand](https://stagehand.dev), Google Gemini, and Playwright Chromium.

World Tester behaves like a real QA engineer — it navigates websites, executes test steps, verifies outcomes, takes screenshots, learns from every interaction, and reports structured results. It remembers what it learns across sessions and gets faster over time.

## Project Structure

```
world-tester/
├── apps/
│   ├── agent/          # Core agent service — CLI + WebSocket API
│   └── web/            # Next.js frontend dashboard
├── packages/
│   └── shared/         # Shared TypeScript types and protocol definitions
├── data/               # Screenshots, browser profiles (shared volume)
├── docker-compose.yml  # Multi-service Docker setup
└── .env                # Configuration (shared by both agent and web)
```

## Setup

Prerequisites: **Node.js 22+** and **PostgreSQL** running locally.

```bash
cp .env.example .env
# Edit .env — set GOOGLE_GENERATIVE_AI_API_KEY (required) and DATABASE_URL (optional, defaults to local)

npm install
```

`npm install` automatically installs Chromium and generates the Prisma client. The database and schema are created automatically the first time the agent starts — no manual migration steps needed.

## Workflows

### 1. CLI Only

The simplest path. The agent runs locally, the browser opens on your desktop, and you interact via your terminal.

```bash
npm run agent
```

Best for: quick tasks, debugging, single-user sessions.

### 2. Frontend + Agent (local dev)

Both services run side by side. The browser renders to a virtual display (Xvfb) and streams to the frontend via VNC — no browser window opens on your desktop.

```bash
npm run dev
```

This starts:
- **Xvfb** — virtual display for the browser
- **x11vnc + websockify** — VNC server + WebSocket proxy so the frontend can stream the browser
- **Agent server** → `localhost:3100` (WebSocket API)
- **Next.js dev server** → `localhost:3000` (open in your browser)

On first run, the script auto-installs any missing system packages (`xvfb`, `x11vnc`, `fluxbox`) via `sudo apt` — you'll be prompted for your password once.

Everything you can do in the CLI is available in the dashboard. You can also start them independently:

```bash
npm run agent:server   # just the agent (browser opens on desktop)
npm run web            # just the frontend
```

Best for: development, full dashboard experience, live browser viewing.

### 3. Docker — Background

The full stack runs containerized and detached. The agent runs headless with Xvfb.

```bash
npm run release            # agent + web, background
npm run release:vnc        # same, with VNC on port 5900
npm run release:agent-only # agent container only, no frontend
```

Then:

```bash
npm run release:logs   # tail logs
npm run release:down   # tear everything down
```

Best for: production-like runs, CI, headless testing, remote servers.

### 4. Docker — Interactive CLI

The agent runs in Docker but gives you a terminal prompt. The browser runs headless inside the container.

```bash
npm run release:interactive          # CLI, no VNC
npm run release:interactive:vnc      # CLI + auto-opens VNC viewer
```

Best for: running the CLI without installing dependencies locally.

### 5. VNC (see the browser in Docker)

When running Docker with VNC enabled, connect to the virtual display:

```bash
npm run vnc   # requires tigervnc-viewer: sudo apt install tigervnc-viewer
```

Works with `release:vnc`, `release:interactive:vnc`, or any Docker run with `VNC=true`.

### All scripts

| Script | Description |
|--------|-------------|
| `npm run agent` | Run agent CLI locally |
| `npm run agent:server` | Run agent WebSocket API server |
| `npm run web` | Run Next.js frontend (dev mode) |
| `npm run dev` | Run both agent server + web frontend concurrently |
| `npm run release` | Docker: full stack in background |
| `npm run release:vnc` | Docker: full stack + VNC |
| `npm run release:interactive` | Docker: interactive agent CLI |
| `npm run release:interactive:vnc` | Docker: interactive agent CLI + VNC |
| `npm run release:agent-only` | Docker: agent container only |
| `npm run vnc` | Connect to VNC viewer |
| `npm run release:logs` | Tail Docker container logs |
| `npm run release:down` | Stop Docker containers |
| `npm run db:generate` | Regenerate Prisma client |
| `npm run db:push` | Push schema to database (happens automatically on start) |

## Frontend

The Next.js frontend at `http://localhost:3000` provides full parity with the CLI:

- **Dashboard** — Live browser view (via noVNC), command terminal, cost summary
- **History** — Task history from the database
- **Reports** — Test reports with step-by-step results, pass/fail badges, and screenshots
- **Knowledge** — Site knowledge and learnings browser
- **Settings** — Agent connection status, cost/billing info, environment details

The frontend connects to the agent via WebSocket (`ws://localhost:3100`). All CLI commands work in the web terminal, including streaming chat responses, real-time test step progress, and browser state updates.

### Dashboard Layouts

Switch between five layouts using header icons or keyboard shortcuts:

| Shortcut | Layout | Description |
|----------|--------|-------------|
| `Alt+1` | Vertical | Browser top, terminal bottom |
| `Alt+2` | Horizontal | Browser left, terminal right |
| `Alt+3` | Browser only | Full-screen browser view |
| `Alt+4` | Terminal only | Full-screen terminal |
| `Alt+5` | Floating | Browser full-screen with draggable terminal overlay |
| `Alt+F` | Flip | Swap panel positions in split layouts |

Layout choice persists in `localStorage`. The sidebar is collapsible via the toggle button.

### Browser Viewing

The dashboard shows the browser in two modes:

- **Live** — Real-time view via noVNC (requires VNC enabled: `VNC=true`)
- **Screenshots** — Timeline of captured screenshots from test runs

Screenshots are automatically saved to `./data/screenshots/` on the host via volume mount.

## Commands

All commands are entered in the CLI or the web terminal. Prefix your input to select a mode, or just type naturally and the agent will figure it out.

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

### Conversation management

The agent supports persistent conversations — switch between them, resume old ones, and all history is preserved.

| Command | Description |
|---------|-------------|
| `conv` / `conversations` | List all conversations |
| `conv:new [title]` | Create a new conversation and switch to it |
| `conv:switch <id>` | Switch to an existing conversation |
| `conv:rename <title>` | Rename the current conversation |
| `conv:archive` | Archive the current conversation |

Conversations auto-title based on the first command you send. All output is persisted — you can close the browser, restart the agent, and pick up where you left off.

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
- **Smart routing** — the chat agent can also decide to spawn or switch browsers automatically
- **Test runner** supports per-step browser targeting for cross-browser QA scenarios

### Browser Automation (CUA)

Uses Google Gemini's Computer Use Agent mode via Stagehand for visual reasoning. The agent sees screenshots of the browser, reasons about UI layout, and performs actions by coordinate. Includes a 4-level retry mechanism for stuck clicks.

### Chat Mode

Conversational interface powered by Gemini Flash. The agent has a QA tester personality — friendly, meticulous, and helpful. It can seamlessly switch from conversation to browser actions when you ask it to do something, then return to chat with a follow-up summary.

### Smart Routing (Auto Mode)

When you type without a prefix, the agent classifies your intent and routes to the appropriate mode. Context from recent conversation is preserved.

### Learning System

The agent builds knowledge in two layers:

- **Site Knowledge** (database): Structured data about each website — pages, forms, interactive elements, navigation paths, data displayed, common flows, tips, and known issues.
- **Learnings** (database): Reusable behavioral patterns organized by category (navigation, recipes, gotchas, general).

### QA Ticket Testing (`test:` command)

Structured end-to-end test execution:

1. **Plan** — Decomposes a ticket into ordered test steps with expected outcomes
2. **Execute** — Runs each step through the CUA browser agent
3. **Screenshot** — Captures before/after screenshots for every step
4. **Verify** — AI-powered comparison of expected vs. actual page state
5. **Report** — Structured report saved to the database

### Cost Tracking

Every API call is tracked per action, per session, and per billing cycle.

### Session Memory

Conversation history and task results persist across sessions in the database.

## Architecture

```
apps/
├── agent/
│   └── src/
│       ├── index.ts                 # CLI entry point
│       ├── server.ts                # WebSocket API server entry point
│       ├── core.ts                  # Shared agent initialization (createAgentCore)
│       ├── output-sink.ts           # Output abstraction (CLI vs WebSocket)
│       ├── cli-sink.ts              # CLI implementation of OutputSink
│       ├── db.ts                    # Prisma client + auto-schema sync
│       ├── config/                  # Environment config loading
│       ├── cli/                     # Command parser, display formatting
│       ├── browser/                 # BrowserPool, BrowserInstance, Stagehand helpers
│       ├── agent/                   # Orchestrator, modes, chat, learning, test runner
│       ├── memory/                  # Prisma-backed knowledge persistence
│       └── cost/                    # Token tracking, pricing, billing ledger
├── web/
│   └── src/
│       ├── app/                     # Next.js App Router pages
│       │   ├── page.tsx             # Dashboard (browser viewer + terminal)
│       │   ├── history/             # Task history
│       │   ├── reports/             # Test reports
│       │   ├── knowledge/           # Site knowledge + learnings
│       │   ├── settings/            # Configuration
│       │   └── api/                 # Screenshot serving API
│       ├── components/              # React components
│       │   ├── command-terminal.tsx  # Interactive command input + output
│       │   ├── browser-viewer.tsx   # noVNC live view + tab bar
│       │   ├── novnc-canvas.tsx     # noVNC wrapper
│       │   ├── agent-provider.tsx   # WebSocket context provider
│       │   └── ...                  # View components for each page
│       └── hooks/
│           └── use-agent-socket.ts  # WebSocket connection + message handling
packages/
└── shared/
    └── src/
        └── types.ts                 # WebSocket protocol, shared domain types
```

### Data Storage

All structured data is stored in **PostgreSQL** via **Prisma ORM**. Filesystem is used for binary files only:

```
data/
├── screenshots/             # Before/after screenshots from test runs
├── .browser-profile/        # Chromium user data for the default browser
├── .browser-profile-<name>/ # Isolated profiles for additional browsers
└── .browser-profile-docker/ # Docker-specific profile (avoids lock conflicts)
```

## Configuration

Set these in `.env` at the project root:

| Variable                       | Required | Default | Description                           |
|--------------------------------|----------|---------|---------------------------------------|
| `GOOGLE_GENERATIVE_AI_API_KEY` | Yes      | —       | Google AI API key                     |
| `DATABASE_URL`                 | No       | `postgresql://postgres:postgres@localhost:5432/worldtester` | PostgreSQL connection string |
| `HEADLESS`                     | No       | `false` | Run browser in headless mode          |
| `TARGET_URL`                   | No       | —       | Auto-navigate to this URL on start    |
| `AGENT_PORT`                   | No       | `3100`  | WebSocket API server port             |
| `WEB_PORT`                     | No       | `3000`  | Frontend web server port              |
| `VNC`                          | No       | `false` | Start VNC server in Docker            |
| `NEXT_PUBLIC_AGENT_WS_URL`    | No       | `ws://localhost:3100` | Agent WS URL for frontend  |
| `NEXT_PUBLIC_VNC_WS_URL`      | No       | `ws://localhost:5901`  | VNC WS URL for frontend   |
| `NEXT_PUBLIC_AGENT_HTTP_URL`  | No       | `http://localhost:3100` | Agent HTTP URL for screenshots |

## Production Deployment

For remote servers, ensure PostgreSQL is running and accessible, then:

```bash
# 1. Clone and configure
git clone <repo-url> && cd world-tester
cp .env.example .env
# Edit .env: set GOOGLE_GENERATIVE_AI_API_KEY and DATABASE_URL

# 2. Create the database (if it doesn't exist yet)
psql "$DATABASE_URL" -c "SELECT 1" 2>/dev/null || \
  psql "$(echo $DATABASE_URL | sed 's|/[^/]*$|/postgres|')" -c "CREATE DATABASE worldtester"

# 3. Deploy via Docker
npm run release

# 4. Check logs
npm run release:logs
```

If port 3000 is already in use, change the frontend port:

```bash
WEB_PORT=4000 npm run release
```

Or set `WEB_PORT=4000` in `.env` for a permanent change.

### Ports

| Port | Service | Configurable via |
|------|---------|------------------|
| 3000 | Frontend (Next.js) | `WEB_PORT` |
| 3100 | Agent (WebSocket + HTTP) | `AGENT_PORT` |
| 5900 | VNC raw TCP | — |
| 5901 | VNC WebSocket proxy | — |

## Docker

The Docker setup runs the full stack:

- **agent** container: Headless Chromium in Xvfb, WebSocket API on port 3100, optional VNC on 5900
- **web** container: Next.js frontend on port 3000

The agent connects to your host PostgreSQL — `localhost` in `DATABASE_URL` is automatically rewritten to `host.docker.internal`.

## Tech Stack

- **[Stagehand](https://stagehand.dev)** — AI browser automation (CUA mode, act/extract/observe)
- **Google Gemini** — `gemini-2.5-computer-use-preview-10-2025` for browser automation, `gemini-2.5-flash` for chat and planning
- **Playwright Chromium** — Local browser with stealth flags
- **Node.js + TypeScript** — Runtime and language, executed via `tsx`
- **PostgreSQL + Prisma ORM** — All structured data persistence
- **Next.js + React** — Frontend dashboard with App Router
- **Tailwind CSS** — Styling with dark theme
- **noVNC** — Live browser streaming to the frontend
- **WebSocket** — Real-time agent-to-frontend communication
- **npm workspaces** — Monorepo management
- **Docker + Docker Compose** — Multi-service containerized execution

### Cost Principle

Everything is free and open-source except the AI model API. No Browserbase, no paid search APIs, no paid npm packages.

## Future Plans

- Multi-model support (Anthropic, OpenAI)
- Slack and platform integrations
- Voice input/output
- HTML/Markdown test report export
- noVNC WebSocket proxy for VNC-less frontend viewing
