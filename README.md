# World Tester

AI-powered QA tester that interacts with web applications in a real browser.
Built with [Stagehand](https://stagehand.dev) and Google Gemini.

## Quick Start

```bash
# Install dependencies
npm install

# Set up your API key
cp .env.example .env
# Edit .env and add your GOOGLE_GENERATIVE_AI_API_KEY

# Run
npm start
```

## Commands

| Prefix | Mode    | Description                            |
|--------|---------|----------------------------------------|
| `e:`   | Extract | Pull information from the current page |
| `a:`   | Act     | Perform a single action                |
| `t:`   | Task    | Execute a complex, multi-step task     |
| `o:`   | Observe | Discover what's on the page            |
| `s:`   | Search  | Search the web via browser             |
| `?:`   | Ask     | Ask the agent a question               |
| `g:`   | Goto    | Navigate to a URL                      |
| (none) | Auto    | Agent decides the best approach        |

### Built-in commands

- `help` — Show available commands
- `cost` — Show session cost summary
- `history` — Show recent task history
- `quit` / `exit` — Close and exit

### Examples

```
> g: https://example.com
> o: what can I interact with?
> a: click the login button
> e: get all the form fields on this page
> t: test the signup flow with valid and invalid data
> s: stagehand browser automation docs
> ?: what issues have I found on this site before?
```

## How It Works

World Tester is a QA tester agent that:

1. **Interacts** with websites using a real local Chromium browser
2. **Learns** from each interaction — stores site knowledge, task history, and patterns
3. **Remembers** across sessions — knowledge persists in `./data/` as JSON files
4. **Tracks costs** — shows token usage and cost after every command

## Configuration

Set these in `.env`:

| Variable                       | Required | Description                  |
|--------------------------------|----------|------------------------------|
| `GOOGLE_GENERATIVE_AI_API_KEY` | Yes      | Your Google AI API key       |
| `HEADLESS`                     | No       | Run browser headless (false) |
| `TARGET_URL`                   | No       | Auto-navigate on startup     |
