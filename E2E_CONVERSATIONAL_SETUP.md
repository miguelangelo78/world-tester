# E2E Conversational Test Creation - Setup Verification

## Changes Made

### 1. Fixed Config System
- **File**: `apps/agent/src/config/types.ts`
  - Added `generativeAiApiKey: string` field
  - Added `apiUrl?: string` field

- **File**: `apps/agent/src/config/index.ts`
  - Now sets `generativeAiApiKey` from `GOOGLE_GENERATIVE_AI_API_KEY`
  - Now sets `apiUrl` from `API_URL` env var (defaults to `http://localhost:3100`)

### 2. Fixed Action Classification
- **File**: `apps/agent/src/agent/chat.ts`
  - Added `"create_e2e_test"` to `validActions` array (line 298)
  - This allows the action to be recognized and routed correctly

### 3. Fixed CLI E2E Test Creation
- **File**: `apps/agent/src/index.ts`
  - Added `domain: "example.com"` to CLI test creation (line 229)
  - This satisfies the new domain requirement

## How to Use Conversational E2E Test Creation

### Via Chat Interface
Send a message like:
```
c: create an E2E test for example.com that logs in, verifies dashboard, and logs out
```

The agent will:
1. **Classify** the intent as `create_e2e_test`
2. **Parse** the description using Gemini AI to generate structured steps
3. **Create** the test via the `/api/e2e/tests` endpoint
4. **Report** success in the chat with test details

### Example Message
```
c: I need an E2E test for coinflake.app. Steps: navigate to homepage, 
click the connect wallet button, and verify the modal appears. Use coinflake.app as the domain.
```

### Response Format
```
✓ E2E test "Connect Wallet Flow" created successfully with 3 steps for domain: coinflake.app
```

## Architecture

```
User Chat Message
    ↓
runSmartChat() [chat.ts]
    ↓
classifyIntent() → {"action": "create_e2e_test", "instruction": "...", "options": {"domain": "..."}}
    ↓
Orchestrator.handle() [orchestrator.ts]
    ↓
case "create_e2e_test":
    ├── parseE2ETestFromConversation() [e2e-creator.ts]
    │   └── Gemini: Natural language → Test structure
    ├── createE2ETestViaAPI() [e2e-creator.ts]
    │   └── POST /api/e2e/tests with test definition
    └── Response: {success: true, message: "✓ Test created..."}
    ↓
Chat displays response to user
```

## Environment Variables Needed

```
GOOGLE_GENERATIVE_AI_API_KEY=<your-key>  # Required for Gemini API
API_URL=http://localhost:3100             # Optional, defaults to localhost:3100
```

## Database Changes

The `E2ETest` model now requires:
- `domain: String!` - The target domain for the test (e.g., "example.com")
- This is enforced in the schema and API validation

## Testing

To test conversational E2E creation:

1. Start the backend: `npm run agent:server`
2. Start the web UI: `npm run web`
3. Open the chat interface
4. Type: `c: create E2E test for example.com that navigates to homepage`
5. Watch the agent create the test and report success

## Troubleshooting

### "Failed to create E2E test: Cannot parse JSON"
- The Gemini API might return invalid JSON. Check:
  - API key is valid
  - Network connection is working
  - Rate limits aren't exceeded

### "Failed to create E2E test: Domain is required"
- Ensure the backend `/api/e2e/tests` endpoint is receiving `domain` field
- Check that the test object being sent includes `domain` in the JSON payload

### Message not classified as "create_e2e_test"
- Try being more explicit: "create an e2e test for..."
- The classifier should detect keywords like "create", "e2e", "test"

## Files Modified

1. `/apps/agent/src/config/types.ts` - Added config fields
2. `/apps/agent/src/config/index.ts` - Set config values
3. `/apps/agent/src/agent/chat.ts` - Added to validActions
4. `/apps/agent/src/index.ts` - Added domain to CLI test creation

## Notes

- The orchestrator already had the handler for `create_e2e_test` (existing code)
- The e2e-creator.ts module was already implemented
- This fix was about connecting the pieces together through proper config and action validation
