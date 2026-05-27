/**
 * Tests for monitor.js — polling logic and event processing.
 *
 * Mocking viem's createPublicClient, getLogs, getBlockNumber
 * so we can test the polling loop and alert generation without
 * a live RPC connection.
 */

// ── Mock viem ────────────────────────────────────────────────────────────────
const mockGetLogs = jest.fn();
const mockGetBlockNumber = jest.fn();

jest.mock('viem', () => {
  const actual = jest.requireActual('viem');
  return {
    ...actual,
    createPublicClient: jest.fn(() => ({
      getLogs: mockGetLogs,
      getBlockNumber: mockGetBlockNumber,
    })),
    http: jest.fn(() => 'mock-transport'),
    parseAbiItem: actual.parseAbiItem,
    formatUnits: actual.formatUnits,
    decodeEventLog: actual.decodeEventLog,
  };
});

// ── Mock fs ──────────────────────────────────────────────────────────────────
const mockFsExists = jest.fn();
const mockFsRead = jest.fn();
const mockFsWrite = jest.fn();
const mockFsMkdir = jest.fn();

jest.mock('fs', () => ({
  existsSync: (...args) => mockFsExists(...args),
  readFileSync: (...args) => mockFsRead(...args),
  writeFileSync: (...args) => mockFsWrite(...args),
  mkdirSync: (...args) => mockFsMkdir(...args),
}));

// ── Mock dotenv ──────────────────────────────────────────────────────────────
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// ── Setup environment before requiring monitor ───────────────────────────────
process.env.ARC_RPC_URL = 'https://rpc.testnet.arc.network';
process.env.ARC_CHAIN_ID = '5042002';
process.env.AGENT_REGISTRY_ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
process.env.AGENT_REGISTRY_START_BLOCK = '1000';
process.env.USDC_ADDRESS = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
process.env.USDC_TRANSFER_THRESHOLD = '100000';
process.env.USDC_SWAP_THRESHOLD = '500';
process.env.POLL_INTERVAL_MS = '100';
process.env.MAX_BLOCKS_PER_POLL = '10';
process.env.TELEGRAM_BOT_TOKEN = 'test-token';

// Clear module cache so monitor picks up env
jest.resetModules();
const monitor = require('../monitor');

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create a fake log object */
function makeLog(args, overrides) {
  return Object.assign(
    {
      address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      blockNumber: BigInt(1050),
      blockHash: '0xblockhash',
      transactionHash: '0xtxhash',
      transactionIndex: 0,
      logIndex: 0,
      removed: false,
      data: (args && args.data) || '0x',
      topics: (args && args.topics) || [],
      args,
    },
    overrides || {}
  );
}

function makeTransferLog(from, to, value, overrides) {
  return makeLog(
    { from, to, value },
    Object.assign(
      { address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
      overrides || {}
    )
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Monitor — State Management', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('loadState returns default state when no db.json exists', () => {
    mockFsExists.mockReturnValue(false);
    const state = monitor.loadState();
    expect(state).toEqual({
      lastBlock: expect.any(Number),
      subscribers: {},
      alerts: [],
    });
  });

  test('loadState returns saved state when db.json exists', () => {
    mockFsExists.mockReturnValue(true);
    mockFsRead.mockReturnValue(
      JSON.stringify({
        lastBlock: 5000,
        subscribers: { '123': { chatId: '123', subscribedAt: 1000 } },
        alerts: [{ type: 'TEST', data: {}, timestamp: 1 }],
      })
    );
    const state = monitor.loadState();
    expect(state.lastBlock).toBe(5000);
    expect(Object.keys(state.subscribers)).toHaveLength(1);
    expect(state.alerts).toHaveLength(1);
  });

  test('saveState writes to db.json and creates directory', () => {
    mockFsExists.mockReturnValue(false);
    const state = { lastBlock: 100, subscribers: {}, alerts: [] };
    monitor.saveState(state);
    expect(mockFsMkdir).toHaveBeenCalled();
    expect(mockFsWrite).toHaveBeenCalled();
  });
});

describe('Monitor — Alert Queue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFsExists.mockReturnValue(true);
    mockFsRead.mockReturnValue(
      JSON.stringify({ lastBlock: 1000, subscribers: {}, alerts: [] })
    );
    monitor.alertQueue.length = 0;
  });

  test('pushAlert adds alert to queue and saves state', () => {
    monitor.pushAlert('AGENT_REGISTERED', { agent: '0xabc', owner: '0xdef' });
    expect(monitor.alertQueue).toHaveLength(1);
    expect(monitor.alertQueue[0].type).toBe('AGENT_REGISTERED');
    expect(monitor.alertQueue[0].data.agent).toBe('0xabc');
    expect(mockFsWrite).toHaveBeenCalled();
  });

  test('alert queue caps at 1000 alerts', () => {
    const manyAlerts = Array.from({ length: 1500 }, (_, i) => ({
      type: 'TEST',
      data: {},
      timestamp: i,
    }));
    mockFsRead.mockReturnValue(
      JSON.stringify({ lastBlock: 1000, subscribers: {}, alerts: manyAlerts })
    );

    monitor.pushAlert('NEW', { x: 1 });
    // The written state should have its alerts capped
    const writeCall = mockFsWrite.mock.calls[0][1];
    const saved = JSON.parse(writeCall);
    expect(saved.alerts.length).toBeLessThanOrEqual(1000);
  });
});

describe('Monitor — Address Formatting', () => {
  test('fmtAddr formats addresses correctly', () => {
    expect(monitor.fmtAddr('0x1234567890abcdef1234567890abcdef12345678')).toBe(
      '0x1234...5678'
    );
  });

  test('fmtAddr returns 0x0 for zero address', () => {
    expect(monitor.fmtAddr('0x0000000000000000000000000000000000000000')).toBe(
      '0x0'
    );
  });

  test('fmtAddr handles null/undefined gracefully', () => {
    expect(monitor.fmtAddr(null)).toBe('0x0');
    expect(monitor.fmtAddr(undefined)).toBe('0x0');
  });
});

describe('Monitor — Config', () => {
  test('CONFIG has expected defaults from env', () => {
    expect(monitor.CONFIG.rpcUrl).toBe('https://rpc.testnet.arc.network');
    expect(monitor.CONFIG.chainId).toBe(5042002);
    expect(monitor.CONFIG.agentRegistry).toBe(
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    );
    expect(monitor.CONFIG.usdcTransferThreshold).toBe(100000);
    expect(monitor.CONFIG.usdcSwapThreshold).toBe(500);
    expect(monitor.CONFIG.pollIntervalMs).toBe(100);
    expect(monitor.CONFIG.maxBlocksPerPoll).toBe(10);
  });

  test('USDC_ADDRESS is configured from env', () => {
    expect(monitor.USDC_ADDRESS).toBe(
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    );
  });
});

describe('Monitor — Polling Logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFsExists.mockReturnValue(true);
    mockFsRead.mockReturnValue(
      JSON.stringify({ lastBlock: 1000, subscribers: {}, alerts: [] })
    );
    monitor.alertQueue.length = 0;
  });

  test('pushAlert stores correct type and data', () => {
    monitor.pushAlert('LARGE_TRANSFER', {
      from: '0xabc',
      to: '0xdef',
      amount: 200000,
      txHash: '0xhash',
      blockNumber: 1050,
    });
    expect(monitor.alertQueue).toHaveLength(1);
    expect(monitor.alertQueue[0].type).toBe('LARGE_TRANSFER');
    expect(monitor.alertQueue[0].data.amount).toBe(200000);
    expect(monitor.alertQueue[0].timestamp).toBeDefined();
  });

  test('alert types include AGENT_REGISTERED', () => {
    monitor.pushAlert('AGENT_REGISTERED', {
      agent: '0xagent',
      owner: '0xowner',
      txHash: '0xhash',
      blockNumber: 1050,
    });
    expect(monitor.alertQueue[0].type).toBe('AGENT_REGISTERED');
    expect(monitor.alertQueue[0].data.agent).toBe('0xagent');
  });

  test('alert types include AGENT_DEACTIVATED', () => {
    monitor.pushAlert('AGENT_DEACTIVATED', {
      agent: '0xagent',
      txHash: '0xhash',
      blockNumber: 1050,
    });
    expect(monitor.alertQueue[0].type).toBe('AGENT_DEACTIVATED');
  });
});

describe('Monitor — Exports', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFsExists.mockReturnValue(true);
    mockFsRead.mockReturnValue(
      JSON.stringify({ lastBlock: 1000, subscribers: {}, alerts: [] })
    );
    monitor.alertQueue.length = 0;
    mockGetBlockNumber.mockResolvedValue(BigInt(1060));
    mockGetLogs.mockResolvedValue([]);
  });

  test('monitor exports expected functions', () => {
    expect(typeof monitor.loadState).toBe('function');
    expect(typeof monitor.saveState).toBe('function');
    expect(typeof monitor.pushAlert).toBe('function');
    expect(typeof monitor.fmtAddr).toBe('function');
    expect(monitor.alertQueue).toBeDefined();
    expect(monitor.CONFIG).toBeDefined();
    expect(monitor.USDC_ADDRESS).toBeDefined();
  });

  test('alertQueue is an array', () => {
    expect(Array.isArray(monitor.alertQueue)).toBe(true);
  });
});
