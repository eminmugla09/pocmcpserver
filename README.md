# FPL EV ChatGPT MCP Pack

This workspace contains an MCP server and Custom GPT configuration pack using sample data for Emin Mugla.

The MCP server reads from [data/mock_data.json](data/mock_data.json), exposes tools shaped like the intended FPL xAPI/MuleSoft contracts, and returns canned action responses. No real FPL, SAP, MuleSoft, billing, city-registration, notification or permitting systems are called.

## Scenarios

1. Emin asks whether he can set up EV home charging at 320 Anchorage Dr in North Palm Beach.
2. The agent receives a home-registration event and proactively offers power connection, EV home charging and a keep-both-vs-move decision.
3. Bonus: Emin asks about his bill, due date, payment status, usage and EV off-peak savings.

## Run locally

```bash
npm install
npm run build
npm start
```

By default, `npm start` runs the MCP server over stdio for local MCP clients. To run the same server as a Railway-style HTTP service, set `PORT` or `MCP_TRANSPORT=http`:

```bash
PORT=3000 npm start
```

HTTP endpoints:

- `POST /mcp`: stateless Streamable HTTP MCP endpoint
- `GET /health`: health check returning `{ "status": "ok", "mcpPath": "/mcp" }`
- `GET /privacy`: public privacy notice for ChatGPT connector/app setup

## Deploy on Railway

Railway sets `PORT` automatically, so the app will start in HTTP mode and expose the MCP endpoint at:

```text
https://<your-railway-domain>/mcp
```

Use this privacy policy URL for ChatGPT connector/app setup:

```text
https://<your-railway-domain>/privacy
```

Use these Railway settings:

- Build command: `npm install && npm run build`
- Start command: `npm start`
- Health check path: `/health`

## MCP server tools

- `get_customer_profile`: Returns Emin's linked accounts, premises and registered Tesla Model Y.
- `lookup_account`: Resolves residential account records by account number, customer number, phone, email, premise number or address.
- `get_account_summary`: Returns account status, standing, rate class, smart meter, enrolled programs and account flags.
- `get_premise_details`: Returns property type, service status, meter, garage and 240V details.
- `get_billing_inquiry`: Returns bill amount, due date, kWh, charge breakdown and EV off-peak savings.
- `get_payment_history`: Returns recent payments and AutoPay details.
- `get_usage_history`: Returns monthly kWh, cost and EV charging kWh.
- `get_ev_enrollment`: Returns existing FPL EVolution Home charger details.
- `check_ev_eligibility`: Returns North Palm Beach EV home charging eligibility and install recommendation.
- `match_property_to_customer`: Simulates the North Palm Beach home-registration trigger.
- `get_service_connection_quote`: Returns deposit, fee and connect-date details.
- `start_service_connection`: Action that schedules power connection.
- `enroll_ev_charging`: Action that starts EV home charging enrollment.
- `set_move_intent`: Action that records keep-both or move-out intent.

## GPT setup files

- [gpt/instructions.md](gpt/instructions.md): Custom GPT instructions.
- [gpt/conversation-starters.md](gpt/conversation-starters.md): Conversation starters.
- [gpt/knowledge.md](gpt/knowledge.md): Knowledge content to upload or paste into the GPT.
- [gpt/actions-openapi.yaml](gpt/actions-openapi.yaml): Optional OpenAPI-style action schema if you expose the MCP tools through an HTTPS adapter.
- [scripts/scenario-1-customer-initiated.md](scripts/scenario-1-customer-initiated.md): Customer-initiated EV charging script.
- [scripts/scenario-2-agent-initiated.md](scripts/scenario-2-agent-initiated.md): Proactive outreach script.
- [scripts/bonus-account-info.md](scripts/bonus-account-info.md): Billing and usage script.

## Positioning

Generic AI explains the FPL EVolution Home program. This FPL agent looks at Emin's specific home, account, EV registration, billing and move context, then takes guided actions.