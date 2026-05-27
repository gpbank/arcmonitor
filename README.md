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
├── bot.js          # Telegram bot (grammy)
├── monitor.js      # Block poller + event watcher (viem)
├── data/
│   └── db.json     # Persistent state (auto-created)
├── .env.example    # Environment template
├── .gitignore
├── package.json
└── README.md
```

- **monitor.js** polls Arc blocks via `viem`, processes ERC-8004 registry events and USDC transfers, and pushes alerts to an in-memory queue shared with `bot.js`.
- **bot.js** runs the Telegram bot with `grammy`, handles user commands, and broadcasts queued alerts to all subscribers every 2 seconds.

## License

MIT
