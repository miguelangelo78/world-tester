# E2E Testing via CLI

Now you can create, run, and manage e2e tests directly from the CLI!

## Commands

### List all tests
```
e2e list
```

Output:
```
E2E Tests (2):
  [abc12345] Login Flow (3 steps)
  [def67890] Checkout Flow (5 steps)
```

### Create a new test
```
e2e create "Login Flow" "Navigate to /login"; "Enter email test@example.com"; "Enter password secret"; "Click Login"
```

The format is:
```
e2e create "test name" "step 1"; "step 2"; "step 3"
```

Each step is natural language. Steps are separated by semicolons and wrapped in quotes.

Output:
```
✓ Created test: Login Flow (3 steps) [abc12345]
```

### Run a test
```
e2e run abc12345
```

Output:
```
ℹ Running: Login Flow...
✓ Test complete: PASSED
ℹ Steps: 3/3 passed
ℹ Duration: 12.3s | Cost: $0.0045
```

### View recent results
```
e2e results abc12345
```

Output:
```
ℹ Recent runs for test abc12345:
  [PASSED] 1/21/2025 (12.3s)
  [FAILED] 1/20/2025 (8.5s)
  [PASSED] 1/19/2025 (11.2s)
```

### Delete a test
```
e2e delete abc12345
```

Output:
```
✓ Deleted test: Login Flow
```

---

## Step Examples

Create a test with real-world steps:

```
e2e create "User Registration" \
  "Navigate to /signup"; \
  "Fill in email with john@example.com"; \
  "Fill in password with SecurePass123!"; \
  "Accept terms and conditions"; \
  "Click signup button"; \
  "Assert confirmation email message appears"
```

Or for an e-commerce flow:

```
e2e create "Checkout" \
  "Go to shop page"; \
  "Add item to cart"; \
  "Click cart"; \
  "Click checkout"; \
  "Fill in shipping address"; \
  "Select payment method"; \
  "Confirm order"; \
  "Assert order confirmation page"
```

---

## How It Works

1. **Natural Language Steps**: Each step is a plain English instruction (no CSS selectors needed)
2. **Automatic Retry**: Failed steps retry automatically (default 2 times)
3. **Screenshots**: Visual regression screenshots captured after each step
4. **Detailed Reporting**: Pass/fail per step, total duration, cost tracking
5. **Cost Tracking**: All tests track LLM costs for billing

---

## Configuration

When creating tests, you can control:
- **Retry count**: How many times to retry a failed step (default: 2)
- **Strictness**: 
  - `low`: Skip failed steps, continue
  - `medium`: Log failures, continue (default)
  - `high`: Stop on first failure
- **Visual regression**: Auto-screenshot each step (default: enabled)

Via CLI, these use defaults. For full control, use the REST API or frontend.

---

## Examples

### Simple Navigation Test
```
e2e create "Homepage" "Visit homepage"; "Assert page title contains World Tester"
```

### Form Filling Test
```
e2e create "Contact Form" \
  "Go to /contact"; \
  "Fill name with John Doe"; \
  "Fill email with john@example.com"; \
  "Fill message with Test message"; \
  "Click submit"; \
  "Assert success message appears"
```

### Multi-Page Flow
```
e2e create "User Onboarding" \
  "Visit signup page"; \
  "Create account with email test@example.com"; \
  "Verify email (use test inbox)"; \
  "Complete profile setup"; \
  "Take product tour"; \
  "Assert dashboard is visible"
```

---

## Tips

- Steps are executed sequentially in the browser
- Use natural language — "Click the green button" not "click selector .btn-green"
- For assertions, start the step with "Assert" — e.g., "Assert page shows success message"
- Stagehand's AI handles the interpretation, so be descriptive
- Each test run is isolated (fresh browser state)

---

## See Also

- `help` — Show all CLI commands
- REST API: `POST /api/e2e/tests` — More control over test config
- Frontend: E2E dashboard for visual designer and results viewer
