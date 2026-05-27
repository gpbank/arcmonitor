import { useEffect, useState, useCallback } from 'react';
import Head from 'next/head';
import AgentCard from '../components/AgentCard';

// ── Types ────────────────────────────────────────────────────────────────────
interface AgentInfo {
  address: string;
  owner: string;
  metadataURI: string;
  active: boolean;
  registeredAt: number;
  updatedAt: number;
  events: EventLog[];
}

interface EventLog {
  type: 'registered' | 'updated' | 'deactivated';
  blockNumber: number;
  txHash: string;
  timestamp: number;
  data: Record<string, unknown>;
}

// ── ABI (subset) ─────────────────────────────────────────────────────────────
const REGISTRY_ABI = [
  {
    type: 'function',
    name: 'totalAgents',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'activeAgents',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getAllAgents',
    inputs: [],
    outputs: [{ type: 'address[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getAgent',
    inputs: [{ type: 'address', name: 'agent' }],
    outputs: [
      { type: 'address', name: 'owner' },
      { type: 'string', name: 'metadataURI' },
      { type: 'bool', name: 'active' },
      { type: 'uint256', name: 'registeredAt' },
      { type: 'uint256', name: 'updatedAt' },
    ],
    stateMutability: 'view',
  },
] as const;

// ── Helpers ──────────────────────────────────────────────────────────────────
const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL || 'https://rpc.testnet.arc.network';
const REGISTRY_ADDRESS =
  process.env.NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS ||
  '0x0000000000000000000000000000000000000000';
const CHAIN_ID = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || '5042002', 10);

function fmtAddr(addr: string): string {
  if (!addr || addr === '0x0000000000000000000000000000000000000000') return '0x0';
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

function fmtTime(ts: number): string {
  return new Date(Number(ts) * 1000).toLocaleString();
}

// ── Dashboard ────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [stats, setStats] = useState({ total: 0, active: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Fallback to mock data if registry isn't deployed yet
      if (
        REGISTRY_ADDRESS === '0x0000000000000000000000000000000000000000'
      ) {
        setAgents(getMockAgents());
        setStats({ total: 3, active: 2 });
        setLoading(false);
        return;
      }

      // Build JSON-RPC calls
      const calls = [
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_call',
          params: [
            {
              to: REGISTRY_ADDRESS,
              data: '0x0ccdd8e7', // totalAgents()
            },
            'latest',
          ],
        },
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'eth_call',
          params: [
            {
              to: REGISTRY_ADDRESS,
              data: '0x6ffa7ea6', // activeAgents()
            },
            'latest',
          ],
        },
        {
          jsonrpc: '2.0',
          id: 3,
          method: 'eth_call',
          params: [
            {
              to: REGISTRY_ADDRESS,
              data: '0xfd644091', // getAllAgents()
            },
            'latest',
          ],
        },
      ];

      const res = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(calls),
      });
      const results = await res.json();

      const total = results[0]?.result ? parseInt(results[0].result, 16) : 0;
      const active = results[1]?.result ? parseInt(results[1].result, 16) : 0;

      setStats({ total, active });

      // Decode agent list (ABI-encoded address[])
      if (results[2]?.result && results[2].result !== '0x') {
        const raw = results[2].result.slice(2); // strip 0x
        const offset = parseInt(raw.slice(0, 64), 16) * 2;
        const len = parseInt(raw.slice(offset, offset + 64), 16) * 2;
        const addrData = raw.slice(offset + 64, offset + 64 + len);

        const agentAddrs: string[] = [];
        for (let i = 0; i < len; i += 64) {
          agentAddrs.push('0x' + addrData.slice(i + 24, i + 64));
        }

        // Fetch details for each agent
        const agentCalls = agentAddrs.map((addr, i) => ({
          jsonrpc: '2.0',
          id: 10 + i,
          method: 'eth_call',
          params: [
            {
              to: REGISTRY_ADDRESS,
              data:
                '0x2fec2d67' +
                addr.slice(2).padStart(64, '0'), // getAgent(address)
            },
            'latest',
          ],
        }));

        const agentRes = await fetch(RPC_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(agentCalls),
        });
        const agentResults = await agentRes.json();

        const agentList: AgentInfo[] = [];
        for (let i = 0; i < agentAddrs.length; i++) {
          if (agentResults[i]?.result && agentResults[i].result !== '0x') {
            const r = agentResults[i].result.slice(2);
            let offset = 0;
            const owner = '0x' + r.slice(offset + 12, offset + 64);
            offset += 64;

            const metaOffset = parseInt(r.slice(offset, offset + 64), 16) * 2;
            offset += 64;
            const activeFlag = parseInt(r.slice(offset, offset + 64), 16) !== 0;
            offset += 64;
            const registeredAt = parseInt(r.slice(offset, offset + 64), 16);
            offset += 64;
            const updatedAt = parseInt(r.slice(offset, offset + 64), 16);

            const metaLen =
              parseInt(r.slice(metaOffset, metaOffset + 64), 16) * 2;
            const metaHex = r.slice(metaOffset + 64, metaOffset + 64 + metaLen);
            let metadataURI = '';
            try {
              metadataURI = Buffer.from(metaHex, 'hex').toString('utf8');
            } catch {
              metadataURI = '(binary data)';
            }

            agentList.push({
              address: agentAddrs[i],
              owner,
              metadataURI,
              active: activeFlag,
              registeredAt,
              updatedAt,
              events: [],
            });
          }
        }
        setAgents(agentList);
      }
    } catch (e: unknown) {
      console.error('Failed to fetch agent data:', e);
      setError(
        e instanceof Error ? e.message : 'Failed to fetch agent data from RPC'
      );
      // Fallback to mock data
      setAgents(getMockAgents());
      setStats({ total: 3, active: 2 });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, [fetchData]);

  return (
    <>
      <Head>
        <title>Arc Agent Monitor — Dashboard</title>
        <meta name="description" content="ERC-8004 Agent Activity Dashboard" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className="dashboard">
        <header className="header">
          <h1>🤖 Arc Agent Monitor</h1>
          <p className="subtitle">
            ERC-8004 Agent Activity Dashboard — Arc Network
          </p>
        </header>

        {/* Stats Cards */}
        <section className="stats-row">
          <div className="stat-card">
            <div className="stat-value">{stats.total}</div>
            <div className="stat-label">Total Agents</div>
          </div>
          <div className="stat-card active">
            <div className="stat-value">{stats.active}</div>
            <div className="stat-label">Active Agents</div>
          </div>
          <div className="stat-card inactive">
            <div className="stat-value">{stats.total - stats.active}</div>
            <div className="stat-label">Deactivated</div>
          </div>
        </section>

        {/* Controls */}
        <section className="controls">
          <button className="btn-refresh" onClick={fetchData} disabled={loading}>
            {loading ? '⏳ Refreshing...' : '🔄 Refresh'}
          </button>
          <span className="info-text">
            Chain ID: {CHAIN_ID} &nbsp;|&nbsp; Registry:{' '}
            <code>{fmtAddr(REGISTRY_ADDRESS)}</code>
          </span>
        </section>

        {/* Error */}
        {error && (
          <section className="error-banner">
            ⚠️ {error} — showing mock data.
          </section>
        )}

        {/* Agent List */}
        <section className="agent-list">
          <h2>Registered Agents</h2>
          {agents.length === 0 && !loading && (
            <div className="empty-state">
              <p>No agents registered yet.</p>
              <p className="hint">Deploy the MockAgentRegistry contract and register agents to see them here.</p>
            </div>
          )}
          {agents.map((agent) => (
            <AgentCard key={agent.address} agent={agent} />
          ))}
        </section>

        <footer className="footer">
          <p>Arc Agent Monitor — Powered by Next.js & viem</p>
        </footer>
      </main>
    </>
  );
}

// ── Mock Data (fallback when no contract deployed) ──────────────────────────
function getMockAgents(): AgentInfo[] {
  return [
    {
      address: '0x1111111111111111111111111111111111111111',
      owner: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      metadataURI: 'ipfs://QmAgentAlpha',
      active: true,
      registeredAt: 1715000000,
      updatedAt: 1715000000,
      events: [
        {
          type: 'registered',
          blockNumber: 1000001,
          txHash: '0xabc123...',
          timestamp: 1715000000,
          data: {},
        },
      ],
    },
    {
      address: '0x2222222222222222222222222222222222222222',
      owner: '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      metadataURI: 'ipfs://QmAgentBeta',
      active: true,
      registeredAt: 1715100000,
      updatedAt: 1715200000,
      events: [
        {
          type: 'registered',
          blockNumber: 1000050,
          txHash: '0xdef456...',
          timestamp: 1715100000,
          data: {},
        },
        {
          type: 'updated',
          blockNumber: 1000100,
          txHash: '0xghi789...',
          timestamp: 1715200000,
          data: { metadataURI: 'ipfs://QmAgentBetaV2' },
        },
      ],
    },
    {
      address: '0x3333333333333333333333333333333333333333',
      owner: '0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
      metadataURI: 'ipfs://QmAgentGamma',
      active: false,
      registeredAt: 1714900000,
      updatedAt: 1715050000,
      events: [
        {
          type: 'registered',
          blockNumber: 999900,
          txHash: '0xjkl012...',
          timestamp: 1714900000,
          data: {},
        },
        {
          type: 'deactivated',
          blockNumber: 1000200,
          txHash: '0xmno345...',
          timestamp: 1715050000,
          data: {},
        },
      ],
    },
  ];
}
