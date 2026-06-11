# EV ChatGPT MCP Data Pack

A self-contained pack so **Emin can stand up an MCP server on a personal machine + personal
ChatGPT account** without touching the corporate network or any real customer data.

This is the deliberate shortcut around the bottleneck of wiring the ChatGPT app connector to the
real `fpl-assistant` MCP. Instead of calling live MuleSoft xAPIs, the MCP tools return **sample
data** shaped exactly like the real APIs.

## Why this is safe
- **No real customer data leaves the network.** Everything in `mock_data.json` is invented.
- **No real APIs are called.** Tools read the local JSON and return canned responses.
- Field names mirror the real SAP `/ev`, `/tmd`, and billusage xAPIs, so the responses look authentic
  and maps 1:1 to the eventual production wiring.

## Files
| File | What it is |
|------|------------|
| `mock_data.json` | All sample data for the customer **Emin Mugla** |
| `tool_specs.md` | Stack-agnostic MCP tool definitions (args + which sample record each returns) |
| `conversation_scripts.md` | The three conversation scripts: Scenario 1, Scenario 2, Bonus |

## How Emin uses it (any stack)
1. Pick a runtime — Python `FastMCP` (matches the parent `fpl-assistant` server) or the Node MCP SDK.
2. Implement the ~9 tools in `tool_specs.md`. Each tool is a few lines: look up a key in
  `mock_data.json` and return it. Action tools return `action_responses.*`.
3. Expose it to ChatGPT as a custom connector / local MCP.
4. Paste the proactivity instructions (bottom of `tool_specs.md`) into the GPT's system prompt.
5. Run the scripts in `conversation_scripts.md`.

## The customer
**Emin Mugla** — Miami condo (`5210099001` / premise `60412233`) with an active FPL EVolution Home
charger and a registered Tesla Model Y; just bought a single-family home at **320 Anchorage Dr,
North Palm Beach** (premise `60587744`, no service yet).

---

## Answering your two questions

### 1. How do we make Scenario 1 less generic?
You're right — "Can I get EV home charging and what do I need?" is answerable by public ChatGPT
today from fpl.com marketing copy. The assistant is strongest when the answer is **grounded in Emin's
data and the agent can act**. Differentiate it with these moves (all built into the mock tools):

- **Answer about *his* specific property, not the program.** `check_ev_eligibility(60587744)` returns
  a real pass/fail against FPL's actual rules: single-family + attached garage ✔, smart meter ✔,
  strong Wi-Fi ✔ — and flags the gap: **no power account yet** and **no 240V circuit in the garage**.
  Generic ChatGPT cannot know any of that.
- **Recommend the right plan from his garage state.** Because there's no 240V circuit, the agent
  recommends **full installation ($36/mo)** instead of equipment-only ($27/mo) — a per-customer
  recommendation.
- **Use his existing relationship.** "You already run our charger in Miami; same model, same off-peak
  discount." Pulls from `get_ev_enrollment` + `get_customer_profile`.
- **Quote *his* numbers.** From `get_billing_inquiry`: "last month you charged 286 kWh, 261 off-peak,
  saving ~$21." Concrete, account-specific.
- **Actually do it.** `start_service_connection` + `enroll_ev_charging` schedule the connection
  (no deposit — good standing since 2018) and start enrollment. Public ChatGPT can only describe;
  ours **transacts**.

**One-line framing for leadership:** *Generic AI explains the program; the FPL agent looks at your
home, tells you what applies to you, and sets it up.*

### 2. Bonus account-info scenario
Added as the **Bonus Scenario** in `conversation_scripts.md`, run two ways:
- **On-demand:** "What's my bill and when's it due?" → $168.74, due June 18, 1,142 kWh, AutoPay set.
- **Proactive:** at session start the agent volunteers "your bill's due in 7 days, AutoPay's got it,
  usage trending down." Tools: `get_account_summary`, `get_billing_inquiry`, `get_payment_history`,
  `get_usage_history`.

---

## How this maps to the real goal
The production target: *FPL agents, chatbots, and AI assistants need governed, real-time access to
customer data behind MuleSoft xAPIs — one central, secure, observable place — instead of every
consumer re-inventing auth and integration.*

This setup supports exactly that:
- The tool names/shapes are the real xAPI contracts (the parent `fpl-assistant` server already
  implements many against live MuleSoft).
- It shows the headline behavior leadership wants: **ChatGPT proactively invoking governed
  tools** — reacting to a property-registration event, checking eligibility, and taking action —
  rather than reciting public info.
- Swapping mock tools for the real MuleSoft-backed `fpl-assistant` tools is the only delta between
  this setup and production; the conversation and UX stay identical.

> **Sample data is 100% invented.** Replace the sample layer with the governed `fpl-assistant` MCP +
> MuleSoft OAuth2 path (see `../AGENTS.md`) for the real integration.
