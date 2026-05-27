# Arc Agent Monitor

Tracks **ERC-8004** agent registrations and **agent-to-agent payments** on the **Arc Network**, sending real-time alerts via Telegram.

## Features

- **ERC-8004 Agent Monitoring** — Detects `AgentRegistered`, `AgentUpdated`, and `AgentDeactivated` events from the on-chain agent registry
- **USDC Transfer Monitoring** — Alerts on large USDC transfers (>100K) and swaps (>500 USDC)
- **Telegram Bot** — Interactive bot with `/start`, `/sub`, `/unsub`, `/status`, `/agents` commands
- **Persistent State** — Stores last processed block and alert history in `data/db.json`
- **Configurable Thresholds** — Adjust poll interval, block range, and transfer thresholds via `.env`

## Prerequisites

- **Node.js** >= 18
- **npm** or **yarn**
- A **Telegram Bot Token** from [@BotFather](https://t.me/BotFather)

## Quick Start

```bash
# 1. Clone the repo
git clone git@github.com:gpbank/arcmonitor.git
cd arcmonitor

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env with your values (Telegram bot token, RPC URL, etc.)

# 4. Run the monitor + bot (two terminals)
# Terminal 1 — Block monitor
npm start

# Terminal 2 — Telegram bot
npm run bot
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `ARC_RPC_URL` | `https://rpc.testnet.arc.network` | Arc Network RPC endpoint |
| `ARC_CHAIN_ID` | `5042002` | Arc Network chain ID |
| `AGENT_REGISTRY_ADDRESS` | `0x0` | ERC-8004 Agent Registry contract address |
| `AGENT_REGISTRY_START_BLOCK` | `0` | Block to start scanning from |
| `TELEGRAM_BOT_TOKEN` | — | Telegram bot token (required) |
| `USDC_SWAP_THRESHOLD` | `500` | Minimum USDC amount to trigger swap alert |
| `USDC_TRANSFER_THRESHOLD` | `100000` | Minimum USDC amount to trigger transfer alert |
| `POLL_INTERVAL_MS` | `5000` | Milliseconds between block polls |
| `MAX_BLOCKS_PER_POLL` | `50` | Maximum blocks to scan per poll cycle |

## Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message with inline keyboard |
| `/sub` | Subscribe to alerts |
| `/unsub` | Unsubscribe from alerts |
| `/status` | Show monitor status (last block, subscriber count) |
| `/agents` | List recent ERC-8004 agent registrations |

## Architecture

```
arcmonitor/
├── bot.js               # Telegram bot (grammy)
├── monitor.js           # Block poller + event watcher (viem)
├── data/
│   └── db.json          # Persistent state (auto-created)
├── contracts/           # Foundry smart contracts
│   ├── foundry.toml     # Foundry config (solc 0.8.20, EVM Paris)
│   ├── src/
│   │   └── MockAgentRegistry.sol  # ERC-8004 agent identity registry
│   └── test/
│       └── MockAgentRegistry.t.sol  # Foundry tests (16 tests)
├── frontend/            # Next.js agent activity dashboard
│   ├── pages/
│   │   ├── _app.tsx
│   │   └── index.tsx    # Dashboard page
│   ├── components/
│   │   └── AgentCard.tsx
│   ├── styles/
│   │   └── globals.css
│   └── package.json
├── __tests__/           # Jest unit tests
│   ├── jest.config.json
│   ├── monitor.test.js  # Monitor polling logic tests
│   └── bot.test.js      # Bot command and broadcast tests
├── .env.example         # Environment template
├── .gitignore
├── package.json
└── README.md
```

- **monitor.js** polls Arc blocks via `viem`, processes ERC-8004 registry events and USDC transfers, and pushes alerts to an in-memory queue shared with `bot.js`.
- **bot.js** runs the Telegram bot with `grammy`, handles user commands, and broadcasts queued alerts to all subscribers every 2 seconds.
- **contracts/** — Foundry project with `MockAgentRegistry.sol` implementing the ERC-8004 agent identity standard (registration, update, deactivation with full event emission).
- **frontend/** — Next.js dashboard displaying registered agents, their status, and recent events fetched via RPC.
- **__tests__/** — Jest tests covering monitor state management, alert queue, config, exports, bot commands, and broadcast logic.

## Testing

```bash
# Run Jest unit tests (monitor + bot)
npm test

# Run Foundry smart contract tests
npm run test:contracts

# Run all tests
npm run test:all
```

## Frontend Dashboard

```bash
cd frontend
cp .env.example .env    # Edit with your RPC URL and registry address
npm install
npm run dev             # Starts at http://localhost:3000
```

The dashboard shows:
- Total / Active / Deactivated agent counts
- Agent cards with address, owner, metadata URI, and activity status
- Recent event history (registrations, updates, deactivations)
- Auto-refreshes every 30 seconds

## License

MIT
