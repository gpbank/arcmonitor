/**
 * Arc Agent Monitor — monitor.js
 *
 * Polls Arc Network blocks and watches for:
 *   - ERC-8004 agent registrations (AgentRegistered events)
 *   - Large USDC transfers (>100K) and swaps (>500 USDC)
 *
 * Alerts are broadcast to all Telegram subscribers via the bot.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createPublicClient, http, parseAbiItem, formatUnits, decodeEventLog } = require('viem');
const { arc } = require('viem/chains'); // fallback — define Arc chain manually

// ── Arc Network chain definition ──────────────────────────────────────────────
const arcTestnet = {
  id: parseInt(process.env.ARC_CHAIN_ID) || 5042002,
  name: 'Arc Testnet',
  network: 'arc-testnet',
  rpcUrls: {
    default: { http: [process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network'] },
  },
};

// ── Config ────────────────────────────────────────────────────────────────────
const CONFIG = {
  rpcUrl: process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network',
  chainId: parseInt(process.env.ARC_CHAIN_ID) || 5042002,
  agentRegistry: process.env.AGENT_REGISTRY_ADDRESS || '0x0000000000000000000000000000000000000000',
  registryStartBlock: parseInt(process.env.AGENT_REGISTRY_START_BLOCK) || 0,
  botToken: process.env.TELEGRAM_BOT_TOKEN || '',
  usdcSwapThreshold: parseFloat(process.env.USDC_SWAP_THRESHOLD) || 500,
  usdcTransferThreshold: parseFloat(process.env.USDC_TRANSFER_THRESHOLD) || 100000,
  minConfirmations: parseInt(process.env.MIN_CONFIRMATIONS) || 1,
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS) || 5000,
  maxBlocksPerPoll: parseInt(process.env.MAX_BLOCKS_PER_POLL) || 50,
};

// ── State ─────────────────────────────────────────────────────────────────────
const DB_PATH = path.join(__dirname, 'data', 'db.json');

function loadState() {
  try {
    if (fs.existsSync(DB_PATH)) {
      return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    }
  } catch (e) { /* ignore */ }
  return { lastBlock: CONFIG.registryStartBlock, subscribers: {}, alerts: [] };
}

function saveState(state) {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(state, null, 2));
}

// ── Public client ─────────────────────────────────────────────────────────────
const client = createPublicClient({
  chain: arcTestnet,
  transport: http(CONFIG.rpcUrl),
});

// ── ERC-8004 Agent Registry ABI (subset — events) ────────────────────────────
const agentRegistryAbi = [
  parseAbiItem('event AgentRegistered(address indexed agent, address indexed owner, uint256 timestamp)'),
  parseAbiItem('event AgentUpdated(address indexed agent, string metadata)'),
  parseAbiItem('event AgentDeactivated(address indexed agent)'),
];

// ── USDC Transfer event ──────────────────────────────────────────────────────
const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

// USDC on Arc testnet — placeholder; set the actual address in .env or here
const USDC_ADDRESS = process.env.USDC_ADDRESS || '0x0000000000000000000000000000000000000000';
const USDC_DECIMALS = 6;

// ── Alert queue (for bot.js to pick up) ──────────────────────────────────────
const alertQueue = [];

/**
 * Add an alert and save it.
 */
function pushAlert(type, data) {
  const alert = { type, data, timestamp: Date.now() };
  const state = loadState();
  state.alerts.unshift(alert);
  if (state.alerts.length > 1000) state.alerts.length = 1000; // cap
  saveState(state);
  alertQueue.push(alert);
  console.log(`[ALERT] ${type}:`, JSON.stringify(data));
}

/**
 * Format an address for display.
 */
function fmtAddr(addr) {
  if (!addr || addr === '0x0000000000000000000000000000000000000000') return '0x0';
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

/**
 * Check if a transfer is a large USDC transfer or swap (> threshold).
 */
function isSignificantUsdcTransfer(event) {
  if (!event.args) return false;
  const { from, to, value } = event.args;
  const amount = parseFloat(formatUnits(value, USDC_DECIMALS));
  if (amount >= CONFIG.usdcTransferThreshold) {
    pushAlert('LARGE_TRANSFER', {
      from: fmtAddr(from),
      to: fmtAddr(to),
      amount,
      txHash: event.transactionHash,
      blockNumber: Number(event.blockNumber),
    });
    return true;
  }
  // Swaps often go through known router addresses or involve a zero-address burn/mint
  if (amount >= CONFIG.usdcSwapThreshold &&
      (from === '0x0000000000000000000000000000000000000000' ||
       to === '0x0000000000000000000000000000000000000000')) {
    pushAlert('LARGE_SWAP', {
      from: fmtAddr(from),
      to: fmtAddr(to),
      amount,
      txHash: event.transactionHash,
      blockNumber: Number(event.blockNumber),
    });
    return true;
  }
  return false;
}

/**
 * Poll a range of blocks for Agent Registry events and USDC transfers.
 */
async function pollBlockRange(fromBlock, toBlock) {
  console.log(`[POLL] Blocks ${fromBlock} → ${toBlock}`);

  // 1. Fetch Agent Registry events
  if (CONFIG.agentRegistry !== '0x0000000000000000000000000000000000000000') {
    try {
      for (const abiItem of agentRegistryAbi) {
        const logs = await client.getLogs({
          address: CONFIG.agentRegistry,
          event: abiItem,
          fromBlock: BigInt(fromBlock),
          toBlock: BigInt(toBlock),
        });

        for (const log of logs) {
          try {
            const decoded = decodeEventLog({ abi: [abiItem], data: log.data, topics: log.topics });
            const eventName = decoded.eventName;
            const args = decoded.args;

            if (eventName === 'AgentRegistered') {
              pushAlert('AGENT_REGISTERED', {
                agent: args.agent,
                owner: args.owner,
                timestamp: args.timestamp?.toString(),
                txHash: log.transactionHash,
                blockNumber: Number(log.blockNumber),
              });
            } else if (eventName === 'AgentDeactivated') {
              pushAlert('AGENT_DEACTIVATED', {
                agent: args.agent,
                txHash: log.transactionHash,
                blockNumber: Number(log.blockNumber),
              });
            }
          } catch (e) {
            // skip undecodable logs
          }
        }
      }
    } catch (e) {
      console.error('[ERROR] Failed to fetch agent registry logs:', e.message);
    }
  }

  // 2. Fetch USDC Transfer events
  if (USDC_ADDRESS !== '0x0000000000000000000000000000000000000000') {
    try {
      const logs = await client.getLogs({
        address: USDC_ADDRESS,
        event: transferEvent,
        fromBlock: BigInt(fromBlock),
        toBlock: BigInt(toBlock),
      });

      for (const log of logs) {
        isSignificantUsdcTransfer(log);
      }
    } catch (e) {
      console.error('[ERROR] Failed to fetch USDC transfer logs:', e.message);
    }
  }
}

/**
 * Main loop: poll new blocks continuously.
 */
async function main() {
  console.log('=== Arc Agent Monitor ===');
  console.log(`RPC: ${CONFIG.rpcUrl}`);
  console.log(`Chain ID: ${CONFIG.chainId}`);
  console.log(`Agent Registry: ${CONFIG.agentRegistry}`);
  console.log(`USDC Address: ${USDC_ADDRESS}`);
  console.log(`Poll interval: ${CONFIG.pollIntervalMs}ms`);
  console.log(`Max blocks/poll: ${CONFIG.maxBlocksPerPoll}`);
  console.log('');

  while (true) {
    try {
      const state = loadState();
      const currentBlock = Number(await client.getBlockNumber());
      const safeBlock = currentBlock - CONFIG.minConfirmations;

      let fromBlock = Math.max(state.lastBlock + 1, CONFIG.registryStartBlock);
      let toBlock = Math.min(fromBlock + CONFIG.maxBlocksPerPoll - 1, safeBlock);

      if (fromBlock <= toBlock) {
        console.log(`[STATUS] Latest block: ${currentBlock}, Safe: ${safeBlock}, Last processed: ${state.lastBlock}`);
        await pollBlockRange(fromBlock, toBlock);
        state.lastBlock = toBlock;
        saveState(state);
      } else {
        console.log(`[STATUS] Waiting... latest=${currentBlock}, safe=${safeBlock}, last=${state.lastBlock}`);
      }

      // Wait before next poll
      await new Promise(r => setTimeout(r, CONFIG.pollIntervalMs));
    } catch (e) {
      console.error('[ERROR] Main loop:', e.message);
      await new Promise(r => setTimeout(r, CONFIG.pollIntervalMs));
    }
  }
}

// ── CCTP Bridge Monitor ───────────────────────────────────────────────────────
const cctp = require('./cctp-monitor');

// Wire CCTP alerts into the shared alert queue
cctp.setAlertQueue(alertQueue, pushAlert);

// Add CCTP polling to the main loop (alongside agent + USDC)
async function pollCCTPRange(fromBlock, toBlock) {
  await cctp.pollCCTP(fromBlock, toBlock);
}

// ── Exports for bot.js ────────────────────────────────────────────────────────
module.exports = {
  loadState, saveState, pushAlert, alertQueue, CONFIG,
  USDC_ADDRESS, fmtAddr,
  cctp, pollCCTPRange,
};

// ── Auto-start if run directly ───────────────────────────────────────────────
if (require.main === module) {
  main().catch(console.error);
}
