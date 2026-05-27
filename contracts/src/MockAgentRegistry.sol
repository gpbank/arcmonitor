// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockAgentRegistry
 * @notice ERC-8004 agent identity registry for the Arc Network.
 *         Stores agent metadata and emits lifecycle events:
 *         AgentRegistered, AgentUpdated, AgentDeactivated.
 *
 *         ERC-8004 defines a standard for on-chain agent identity
 *         with metadata, ownership, and activity status.
 */
contract MockAgentRegistry {
    // ── Errors ──────────────────────────────────────────────────────────────
    error AgentAlreadyExists(address agent);
    error AgentNotRegistered(address agent);
    error NotAgentOwner(address agent, address caller);
    error AgentAlreadyDeactivated(address agent);

    // ── Events ──────────────────────────────────────────────────────────────
    event AgentRegistered(
        address indexed agent,
        address indexed owner,
        string metadataURI,
        uint256 timestamp
    );

    event AgentUpdated(
        address indexed agent,
        string metadataURI,
        uint256 timestamp
    );

    event AgentDeactivated(
        address indexed agent,
        uint256 timestamp
    );

    // ── Structs ─────────────────────────────────────────────────────────────
    struct Agent {
        address owner;
        string metadataURI;
        bool active;
        uint256 registeredAt;
        uint256 updatedAt;
    }

    // ── State ───────────────────────────────────────────────────────────────
    mapping(address => Agent) private _agents;
    address[] private _agentList;

    uint256 public totalAgents;
    uint256 public activeAgents;

    // ── External / Public Functions ─────────────────────────────────────────

    /**
     * @notice Register a new agent.
     * @param agent       The address of the agent.
     * @param metadataURI URI pointing to agent metadata (off-chain).
     */
    function registerAgent(address agent, string calldata metadataURI) external {
        if (_agents[agent].owner != address(0)) {
            revert AgentAlreadyExists(agent);
        }

        _agents[agent] = Agent({
            owner: msg.sender,
            metadataURI: metadataURI,
            active: true,
            registeredAt: block.timestamp,
            updatedAt: block.timestamp
        });

        _agentList.push(agent);
        totalAgents++;
        activeAgents++;

        emit AgentRegistered(agent, msg.sender, metadataURI, block.timestamp);
    }

    /**
     * @notice Update an agent's metadata URI.
     * @param agent       The agent address.
     * @param metadataURI New metadata URI.
     */
    function updateAgent(address agent, string calldata metadataURI) external {
        Agent storage a = _agents[agent];
        if (a.owner == address(0)) {
            revert AgentNotRegistered(agent);
        }
        if (a.owner != msg.sender) {
            revert NotAgentOwner(agent, msg.sender);
        }

        a.metadataURI = metadataURI;
        a.updatedAt = block.timestamp;

        emit AgentUpdated(agent, metadataURI, block.timestamp);
    }

    /**
     * @notice Deactivate an agent (owner only).
     * @param agent The agent address to deactivate.
     */
    function deactivateAgent(address agent) external {
        Agent storage a = _agents[agent];
        if (a.owner == address(0)) {
            revert AgentNotRegistered(agent);
        }
        if (a.owner != msg.sender) {
            revert NotAgentOwner(agent, msg.sender);
        }
        if (!a.active) {
            revert AgentAlreadyDeactivated(agent);
        }

        a.active = false;
        activeAgents--;

        emit AgentDeactivated(agent, block.timestamp);
    }

    // ── View Functions ──────────────────────────────────────────────────────

    /**
     * @notice Check if an agent is registered and active.
     */
    function isAgent(address agent) external view returns (bool) {
        return _agents[agent].active;
    }

    /**
     * @notice Get full agent details.
     */
    function getAgent(address agent) external view returns (Agent memory) {
        if (_agents[agent].owner == address(0)) {
            revert AgentNotRegistered(agent);
        }
        return _agents[agent];
    }

    /**
     * @notice Get the owner of an agent.
     */
    function ownerOf(address agent) external view returns (address) {
        if (_agents[agent].owner == address(0)) {
            revert AgentNotRegistered(agent);
        }
        return _agents[agent].owner;
    }

    /**
     * @notice Get all registered agent addresses.
     */
    function getAllAgents() external view returns (address[] memory) {
        return _agentList;
    }

    /**
     * @notice Get paginated agent list.
     */
    function getAgentsPaginated(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory agents, uint256 total)
    {
        total = _agentList.length;
        if (offset >= total) {
            return (new address[](0), total);
        }
        uint256 end = offset + limit;
        if (end > total) end = total;
        uint256 count = end - offset;
        agents = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            agents[i] = _agentList[offset + i];
        }
    }
}
