/**
 * Arc Agent Monitor — bot.js
 *
 * Telegram bot for the Arc Agent Monitor.
 * Commands:
 *   /start   — Welcome message and help
 *   /sub     — Subscribe to alerts
 *   /unsub   — Unsubscribe from alerts
 *   /status  — Show monitor status (latest block, sub count)
 *   /agents  — List recent agent registrations
 */

require('dotenv').config();
const { Bot, InlineKeyboard } = require('grammy');
const monitor = require('./monitor');

// ── Config ────────────────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
if (!BOT_TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN not set in .env');
  process.exit(1);
}

const bot = new Bot(BOT_TOKEN);

// ── Helpers ───────────────────────────────────────────────────────────────────

function isSubscribed(chatId) {
  const state = monitor.loadState();
  return !!state.subscribers[chatId];
}

function subscribe(chatId) {
  const state = monitor.loadState();
  state.subscribers[chatId] = { subscribedAt: Date.now(), chatId };
  monitor.saveState(state);
}

function unsubscribe(chatId) {
  const state = monitor.loadState();
  delete state.subscribers[chatId];
  monitor.saveState(state);
}

function getSubscriberCount() {
  const state = monitor.loadState();
  return Object.keys(state.subscribers).length;
}

function getRecentAlerts(type, limit = 10) {
  const state = monitor.loadState();
  if (type) {
    return state.alerts.filter(a => a.type === type).slice(0, limit);
  }
  return state.alerts.slice(0, limit);
}

function formatAlert(alert) {
  const d = new Date(alert.timestamp).toLocaleString();
  const data = alert.data;

  switch (alert.type) {
    case 'AGENT_REGISTERED':
      return `🤖 *New Agent Registered*\n` +
        `Agent: \`${data.agent}\`\n` +
        `Owner: \`${data.owner}\`\n` +
        `Block: ${data.blockNumber}\n` +
        `Time: ${d}\n` +
        `Tx: \`${data.txHash}\``;

    case 'AGENT_DEACTIVATED':
      return `⛔ *Agent Deactivated*\n` +
        `Agent: \`${data.agent}\`\n` +
        `Block: ${data.blockNumber}\n` +
        `Time: ${d}\n` +
        `Tx: \`${data.txHash}\``;

    case 'LARGE_TRANSFER':
      return `💸 *Large USDC Transfer*\n` +
        `Amount: *${data.amount.toLocaleString()} USDC*\n` +
        `From: \`${data.from}\`\n` +
        `To: \`${data.to}\`\n` +
        `Block: ${data.blockNumber}\n` +
        `Time: ${d}\n` +
        `Tx: \`${data.txHash}\``;

    case 'LARGE_SWAP':
      return `🔄 *Large USDC Swap*\n` +
        `Amount: *${data.amount.toLocaleString()} USDC*\n` +
        `From: \`${data.from}\`\n` +
        `To: \`${data.to}\`\n` +
        `Block: ${data.blockNumber}\n` +
        `Time: ${d}\n` +
        `Tx: \`${data.txHash}\``;

    case 'CCTP_BRIDGE_IN':
      return `🌉 *USDC Bridged INTO Arc*\n` +
        `Amount: *${data.amount} USDC*\n` +
        `From: ${data.from}\n` +
        `To: ${data.to}\n` +
        `Block: ${data.blockNumber}\n` +
        `Time: ${d}\n` +
        `Tx: \`${data.txHash}\``;

    case 'CCTP_BRIDGE_OUT':
      return `🌉 *USDC Bridged OUT of Arc*\n` +
        `Amount: *${data.amount} USDC*\n` +
        `From: ${data.from}\n` +
        `To: ${data.to}\n` +
        `Sender: \`${data.sender}\`\n` +
        `Block: ${data.blockNumber}\n` +
        `Time: ${d}\n` +
        `Tx: \`${data.txHash}\``;

    default:
      return `📢 Alert: ${JSON.stringify(data)}`;
  }
}

// ── Commands ──────────────────────────────────────────────────────────────────

bot.command('start', async (ctx) => {
  const chatId = ctx.chat.id;
  const subbed = isSubscribed(chatId);

  const keyboard = new InlineKeyboard()
    .text(subbed ? '✅ Subscribed' : '🔔 Subscribe', 'sub')
    .row()
    .text('📊 Status', 'status')
    .text('🤖 Agents', 'agents');

  await ctx.reply(
    `🏦 *Arc Agent Monitor*\n\n` +
    `Track ERC-8004 agent registrations, large USDC transfers, and CCTP cross-chain bridges on Arc Network.\n\n` +
    `Commands:\n` +
    `/sub — Subscribe to alerts\n` +
    `/unsub — Unsubscribe\n` +
    `/status — Monitor status\n` +
    `/agents — Recent agents\n` +
    `/bridge — CCTP bridge stats\n\n` +
    `Status: ${subbed ? '🟢 Subscribed' : '⚪ Not subscribed'}`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
});

bot.command('sub', async (ctx) => {
  const chatId = ctx.chat.id;
  if (isSubscribed(chatId)) {
    await ctx.reply('✅ You are already subscribed to Arc Agent Monitor alerts.');
    return;
  }
  subscribe(chatId);
  await ctx.reply(
    '🔔 *Subscribed!*\n\n' +
    'You will now receive alerts for:\n' +
    '• New ERC-8004 agent registrations\n' +
    '• Large USDC transfers (>' + monitor.CONFIG.usdcTransferThreshold.toLocaleString() + ' USDC)\n' +
    '• Large USDC swaps (>' + monitor.CONFIG.usdcSwapThreshold + ' USDC)\n' +
    '• CCTP bridge transactions (>' + monitor.cctp.CONFIG.bridgeAlertThreshold + ' USDC)\n\n' +
    'Use /unsub to stop receiving alerts.',
    { parse_mode: 'Markdown' }
  );
});

bot.command('unsub', async (ctx) => {
  const chatId = ctx.chat.id;
  if (!isSubscribed(chatId)) {
    await ctx.reply('⚪ You are not currently subscribed.');
    return;
  }
  unsubscribe(chatId);
  await ctx.reply('🔕 *Unsubscribed.* You will no longer receive alerts. Use /sub to re-subscribe.', { parse_mode: 'Markdown' });
});

bot.command('status', async (ctx) => {
  const state = monitor.loadState();
  const subCount = getSubscriberCount();
  const alertCount = state.alerts.length;

  await ctx.reply(
    `📊 *Arc Agent Monitor Status*\n\n` +
    `Last block processed: \`${state.lastBlock}\`\n` +
    `Subscribers: ${subCount}\n` +
    `Total alerts: ${alertCount}\n` +
    `Poll interval: ${monitor.CONFIG.pollIntervalMs}ms\n` +
    `USDC transfer threshold: ${monitor.CONFIG.usdcTransferThreshold.toLocaleString()}\n` +
    `USDC swap threshold: ${monitor.CONFIG.usdcSwapThreshold}`,
    { parse_mode: 'Markdown' }
  );
});

bot.command('agents', async (ctx) => {
  const agents = getRecentAlerts('AGENT_REGISTERED', 10);

  if (agents.length === 0) {
    await ctx.reply('🤖 No agent registrations detected yet.', { parse_mode: 'Markdown' });
    return;
  }

  const lines = ['🤖 *Recent Agent Registrations*\n'];
  for (const a of agents) {
    lines.push(`• \`${monitor.fmtAddr(a.data.agent)}\` — Block ${a.data.blockNumber}`);
  }

  await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
});

bot.command('bridge', async (ctx) => {
  const stats = monitor.cctp.getBridgeStats();
  const byChain = monitor.cctp.getVolumeByChain();
  const topDepositors = monitor.cctp.getTopDepositors(5);

  let msg = '🌉 *CCTP Bridge Monitor*\n\n';

  if (byChain.length === 0) {
    msg += 'No bridge activity detected yet.\n';
  } else {
    msg += '*Volume by Source Chain:*\n';
    for (const chain of byChain.slice(0, 5)) {
      msg += `• ${chain.name}: ${monitor.cctp.formatUSDC(BigInt(chain.volume))} USDC (${chain.count} txs)\n`;
    }

    if (topDepositors.length > 0) {
      msg += '\n*Top Depositors:*\n';
      for (const d of topDepositors) {
        msg += `• \`${monitor.cctp.fmtAddr(d.address)}\`: ${monitor.cctp.formatUSDC(BigInt(d.volume))} USDC\n`;
      }
    }

    msg += `\nRecent bridges: ${stats.recentBridges.length}`;
  }

  msg += `\n\nAlert threshold: ${monitor.cctp.CONFIG.bridgeAlertThreshold} USDC`;
  msg += `\nCCTP Domain: ${monitor.cctp.CONFIG.arcDomain} (Arc)`;

  await ctx.reply(msg, { parse_mode: 'Markdown' });
});

// ── Callback handlers for inline keyboard ─────────────────────────────────────

bot.callbackQuery('sub', async (ctx) => {
  const chatId = ctx.chat.id;
  if (isSubscribed(chatId)) {
    await ctx.answerCallbackQuery('Already subscribed!');
    return;
  }
  subscribe(chatId);
  await ctx.answerCallbackQuery('Subscribed! 🔔');
  await ctx.editMessageReplyMarkup({
    reply_markup: new InlineKeyboard()
      .text('✅ Subscribed', 'sub')
      .row()
      .text('📊 Status', 'status')
      .text('🤖 Agents', 'agents'),
  });
});

bot.callbackQuery('status', async (ctx) => {
  const state = monitor.loadState();
  const subCount = getSubscriberCount();
  await ctx.answerCallbackQuery(`Block: ${state.lastBlock} | Subs: ${subCount}`);
});

bot.callbackQuery('agents', async (ctx) => {
  const agents = getRecentAlerts('AGENT_REGISTERED', 5);
  const count = agents.length;
  await ctx.answerCallbackQuery(count > 0 ? `${count} agents registered` : 'No agents yet');
});

// ── Broadcast alerts to subscribers ───────────────────────────────────────────

async function broadcastAlerts() {
  const state = monitor.loadState();

  // Check for new alerts in the queue
  while (monitor.alertQueue.length > 0) {
    const alert = monitor.alertQueue.shift();
    const message = formatAlert(alert);
    const subscribers = Object.keys(state.subscribers);

    for (const chatIdStr of subscribers) {
      try {
        const chatId = parseInt(chatIdStr);
        await bot.api.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      } catch (e) {
        // Remove invalid subscribers
        console.error(`[BROADCAST] Failed to send to ${chatIdStr}:`, e.message);
        if (e.error_code === 403 || e.error_code === 400) {
          delete state.subscribers[chatIdStr];
        }
      }
    }
    // Reload state in case subscribers changed
    monitor.saveState(state);
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────

console.log('🤖 Starting Arc Agent Monitor bot...');

// Broadcast loop: check for new alerts every 2 seconds
setInterval(broadcastAlerts, 2000);

bot.start({
  onStart: (botInfo) => {
    console.log(`✅ Bot @${botInfo.username} is running!`);
  },
});
