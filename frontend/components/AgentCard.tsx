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

function fmtAddr(addr: string): string {
  if (!addr) return '';
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

function fmtTime(ts: number): string {
  return new Date(Number(ts) * 1000).toLocaleString();
}

const EVENT_ICONS: Record<string, string> = {
  registered: '🟢',
  updated: '🔄',
  deactivated: '⛔',
};

export default function AgentCard({ agent }: { agent: AgentInfo }) {
  return (
    <div className={`agent-card ${agent.active ? 'active' : 'deactivated'}`}>
      <div className="agent-card-header">
        <span className={`status-dot ${agent.active ? 'on' : 'off'}`} />
        <code className="agent-address">{fmtAddr(agent.address)}</code>
        <span className="agent-badge">
          {agent.active ? 'Active' : 'Deactivated'}
        </span>
      </div>

      <div className="agent-card-body">
        <div className="agent-detail">
          <span className="label">Full Address</span>
          <code className="value">{agent.address}</code>
        </div>
        <div className="agent-detail">
          <span className="label">Owner</span>
          <code className="value">{fmtAddr(agent.owner)}</code>
        </div>
        <div className="agent-detail">
          <span className="label">Metadata</span>
          <code className="value">{agent.metadataURI}</code>
        </div>
        <div className="agent-detail-row">
          <div className="agent-detail">
            <span className="label">Registered</span>
            <span className="value">{fmtTime(agent.registeredAt)}</span>
          </div>
          <div className="agent-detail">
            <span className="label">Updated</span>
            <span className="value">{fmtTime(agent.updatedAt)}</span>
          </div>
        </div>
      </div>

      {agent.events.length > 0 && (
        <div className="agent-events">
          <h4>Recent Events</h4>
          <ul>
            {agent.events.map((ev, i) => (
              <li key={i}>
                <span className="event-icon">
                  {EVENT_ICONS[ev.type] || '📢'}
                </span>
                <span className="event-type">{ev.type}</span>
                <span className="event-block">Block {ev.blockNumber}</span>
                {ev.data && Object.keys(ev.data).length > 0 && (
                  <span className="event-data">
                    {JSON.stringify(ev.data)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
