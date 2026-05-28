/**
 * ArcBridge Monitor — cctp-monitor.js
 *
 * Watches CCTP (Cross-Chain Transfer Protocol) MessageSent events on Arc.
 * Tracks USDC bridging from other chains into Arc, alerting subscribers.
 *
 * CCTP Domain: 26 (Arc)
 *
 * Strategy:
 *   1. Poll MessageSent events from TokenMessenger contract
 *   2. Parse amount, source domain, destination domain, sender
 *   3. Alert when USDC is bridged INTO Arc (destinationDomain === 26)
 *   4. Track volume by source chain, top depositors
 */

require('dotenv').config();
const { createPublicClient, http, parseAbiItem, decodeEventLog, formatUnits } = require('viem');

// ── Arc Network chain definition ──────────────────────────────────────────────
const arcTestnet = {
  id: parseInt(process.env.ARC_CHAIN_ID) || 5042002,
  name: 'Arc Testnet',
  network: 'arc-testnet',
  rpcUrls: {
    default: { http: [process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network'] },
  },
};

// ── CCTP Domain mapping ────────────────────────────────────────────────────────
const DOMAIN_NAMES = {
  0: 'Ethereum',
  1: 'Avalanche',
  2: 'OP Mainnet',
  3: 'Arbitrum',
  6: 'Base',
  7: 'Polygon PoS',
  26: 'Arc',
};

function domainName(id) {
  return DOMAIN_NAMES[id] || `Domain ${id}`;
}

// ── Config ────────────────────────────────────────────────────────────────────
const CONFIG = {
  rpcUrl: process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network',
  chainId: parseInt(process.env.ARC_CHAIN_ID) || 5042002,
  tokenMessenger: process.env.CCTP_TOKEN_MESSENGER || '0x0000000000000000000000000000000000000000',
  messageTransmitter: process.env.CCTP_MESSAGE_TRANSMITTER || '0x0000000000000000000000000000000000000000',
  cctpStartBlock: parseInt(process.env.CCTP_START_BLOCK) || 0,
  pollIntervalMs: parseInt(process.env.CCTP_POLL_INTERVAL_MS) || 10000,
  arcDomain: 26,
  bridgeAlertThreshold: parseFloat(process.env.CCTP_ALERT_THRESHOLD) || 1000, // min USDC to alert
};

// ── Public client ─────────────────────────────────────────────────────────────
const client = createPublicClient({
  chain: arcTestnet,
  transport: http(CONFIG.rpcUrl),
});

// ── CCTP MessageSent event ────────────────────────────────────────────────────
const messageSentEvent = parseAbiItem(
  'event MessageSent(bytes32 indexed messageHash, address indexed sender, uint32 nonce, uint32 destinationDomain, uint64 amount, bytes32 recipient)'
);

// ── CCTP MessageReceived event ────────────────────────────────────────────────
const messageReceivedEvent = parseAbiItem(
  'event MessageReceived(bytes32 indexed messageHash, uint32 indexed sourceDomain, uint64 amount, bytes32 recipient)'
);

// ── State ─────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const DB_PATH = path.join(__dirname, 'data', 'cctp-db.json');

function loadState() {
  try {
    if (fs.existsSync(DB_PATH)) {
      return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    }
  } catch (e) { /* ignore */ }
  return {
    lastBlock: CONFIG.cctpStartBlock,
    bridgeStats: {},       // { sourceDomain: { count, volume, lastTx } }
    topDepositors: {},     // { sender: { count, volume } }
    recentBridges: [],     // last 100 bridge events
  };
}

function saveState(state) {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(state, null, 2));
}

// ── Alert queue (shared with bot.js) ──────────────────────────────────────────
let alertQueue = [];
let pushAlertFn = null;

function setAlertQueue(queue, pushFn) {
  alertQueue = queue;
  pushAlertFn = pushFn;
}

function emitAlert(type, data) {
  const alert = { type, data, timestamp: Date.now() };
  if (pushAlertFn) {
    pushAlertFn(type, data);
  }
  // Also add to local queue
  alertQueue.push(alert);
  console.log(`[CCTP] ${type}:`, JSON.stringify(data));
}

// ── Format helpers ────────────────────────────────────────────────────────────
function fmtAddr(addr) {
  if (!addr || addr === '0x0000000000000000000000000000000000000000') return '0x0';
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

function formatUSDC(amount) {
  return parseFloat(formatUnits(amount, 6)).toLocaleString();
}

// ── Bridge stats helpers ──────────────────────────────────────────────────────
function updateBridgeStats(state, sourceDomain, sender, amount) {
  // Per-domain stats
  if (!state.bridgeStats[sourceDomain]) {
    state.bridgeStats[sourceDomain] = { count: 0, volume: 0, lastTx: null };
  }
  state.bridgeStats[sourceDomain].count++;
  state.bridgeStats[sourceDomain].volume += amount;
  state.bridgeStats[sourceDomain].lastTx = Date.now();

  // Per-depositor stats
  if (!state.topDepositors[sender]) {
    state.topDepositors[sender] = { count: 0, volume: 0 };
  }
  state.topDepositors[sender].count++;
  state.topDepositors[sender].volume += amount;
}

// ── Poll CCTP events ──────────────────────────────────────────────────────────
async function pollCCTP(fromBlock, toBlock) {
  console.log(`[CCTP] Polling blocks ${fromBlock} → ${toBlock}`);

  if (CONFIG.tokenMessenger === '0x0000000000000000000000000000000000000000') {
    console.log('[CCTP] TokenMessenger address not configured — skipping');
    return;
  }

  const state = loadState();

  try {
    // 1. Fetch MessageSent events (bridges OUT from Arc to other chains)
    const outLogs = await client.getLogs({
      address: CONFIG.tokenMessenger,
      event: messageSentEvent,
      fromBlock: BigInt(fromBlock),
      toBlock: BigInt(toBlock),
    });

    for (const log of outLogs) {
      try {
        const decoded = decodeEventLog({
          abi: [messageSentEvent],
          data: log.data,
          topics: log.topics,
        });
        const { sender, destinationDomain, amount, messageHash } = decoded.args;
        const amountNum = Number(amount);

        updateBridgeStats(state, Number(destinationDomain), sender, amountNum);

        const bridge = {
          messageHash,
          sender,
          sourceDomain: CONFIG.arcDomain,
          destinationDomain: Number(destinationDomain),
          amount: amountNum,
          direction: 'OUT',
          txHash: log.transactionHash,
          blockNumber: Number(log.blockNumber),
        };

        state.recentBridges.unshift(bridge);
        if (state.recentBridges.length > 100) state.recentBridges.length = 100;

        if (amountNum >= CONFIG.bridgeAlertThreshold * 1e6) {
          emitAlert('CCTP_BRIDGE_OUT', {
            from: domainName(CONFIG.arcDomain),
            to: domainName(Number(destinationDomain)),
            sender: fmtAddr(sender),
            amount: formatUSDC(amount),
            txHash: log.transactionHash,
            blockNumber: Number(log.blockNumber),
          });
        }
      } catch (e) { /* skip */ }
    }

    // 2. Fetch MessageReceived events (bridges INTO Arc from other chains)
    if (CONFIG.messageTransmitter !== '0x0000000000000000000000000000000000000000') {
      const inLogs = await client.getLogs({
        address: CONFIG.messageTransmitter,
        event: messageReceivedEvent,
        fromBlock: BigInt(fromBlock),
        toBlock: BigInt(toBlock),
      });

      for (const log of inLogs) {
        try {
          const decoded = decodeEventLog({
            abi: [messageReceivedEvent],
            data: log.data,
            topics: log.topics,
          });
          const { sourceDomain, amount, messageHash } = decoded.args;
          const amountNum = Number(amount);

          // Extract sender from messageHash or transaction (simplified)
          const sender = log.transactionHash ? fmtAddr(log.transactionHash) : 'unknown';

          updateBridgeStats(state, Number(sourceDomain), sender, amountNum);

          const bridge = {
            messageHash,
            sender,
            sourceDomain: Number(sourceDomain),
            destinationDomain: CONFIG.arcDomain,
            amount: amountNum,
            direction: 'IN',
            txHash: log.transactionHash,
            blockNumber: Number(log.blockNumber),
          };

          state.recentBridges.unshift(bridge);
          if (state.recentBridges.length > 100) state.recentBridges.length = 100;

          if (amountNum >= CONFIG.bridgeAlertThreshold * 1e6) {
            emitAlert('CCTP_BRIDGE_IN', {
              from: domainName(Number(sourceDomain)),
              to: domainName(CONFIG.arcDomain),
              amount: formatUSDC(amount),
              txHash: log.transactionHash,
              blockNumber: Number(log.blockNumber),
            });
          }
        } catch (e) { /* skip */ }
      }
    }
  } catch (e) {
    console.error('[CCTP] Error polling:', e.message);
  }

  state.lastBlock = toBlock;
  saveState(state);
}

// ── Main loop ─────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== ArcBridge CCTP Monitor ===');
  console.log(`RPC: ${CONFIG.rpcUrl}`);
  console.log(`TokenMessenger: ${CONFIG.tokenMessenger}`);
  console.log(`MessageTransmitter: ${CONFIG.messageTransmitter}`);
  console.log(`Alert threshold: ${CONFIG.bridgeAlertThreshold} USDC`);
  console.log(`Poll interval: ${CONFIG.pollIntervalMs}ms`);
  console.log('');

  while (true) {
    try {
      const state = loadState();
      const currentBlock = Number(await client.getBlockNumber());
      const safeBlock = currentBlock - 1;

      let fromBlock = Math.max(state.lastBlock + 1, CONFIG.cctpStartBlock);
      let toBlock = Math.min(fromBlock + 20, safeBlock);

      if (fromBlock <= toBlock) {
        await pollCCTP(fromBlock, toBlock);
      }

      await new Promise(r => setTimeout(r, CONFIG.pollIntervalMs));
    } catch (e) {
      console.error('[CCTP] Main loop error:', e.message);
      await new Promise(r => setTimeout(r, CONFIG.pollIntervalMs));
    }
  }
}

// ── Stats API for bot ─────────────────────────────────────────────────────────
function getBridgeStats() {
  return loadState();
}

function getTopDepositors(limit = 5) {
  const state = loadState();
  return Object.entries(state.topDepositors)
    .sort((a, b) => b[1].volume - a[1].volume)
    .slice(0, limit)
    .map(([addr, stats]) => ({ address: addr, ...stats }));
}

function getVolumeByChain() {
  const state = loadState();
  return Object.entries(state.bridgeStats)
    .map(([domain, stats]) => ({
      domain: Number(domain),
      name: domainName(Number(domain)),
      ...stats,
    }))
    .sort((a, b) => b.volume - a.volume);
}

// ── Exports ───────────────────────────────────────────────────────────────────
module.exports = {
  CONFIG,
  loadState,
  saveState,
  setAlertQueue,
  emitAlert,
  pollCCTP,
  getBridgeStats,
  getTopDepositors,
  getVolumeByChain,
  domainName,
  fmtAddr,
  formatUSDC,
  alertQueue,
};

// ── Auto-start if run directly ───────────────────────────────────────────────
if (require.main === module) {
  main().catch(console.error);
}
