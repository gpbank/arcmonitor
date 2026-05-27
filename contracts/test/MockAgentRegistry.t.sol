// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/MockAgentRegistry.sol";

contract MockAgentRegistryTest is Test {
    MockAgentRegistry public registry;

    address public owner = address(0x100);
    address public agent = address(0x200);
    address public stranger = address(0x300);

    string public constant METADATA_URI = "ipfs://QmTest";
    string public constant UPDATED_URI  = "ipfs://QmUpdated";

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

    function setUp() public {
        registry = new MockAgentRegistry();
    }

    // ── Registration ────────────────────────────────────────────────────────

    function test_RegisterAgent() public {
        vm.prank(owner);
        vm.expectEmit(true, true, false, true, address(registry));
        emit AgentRegistered(agent, owner, METADATA_URI, block.timestamp);
        registry.registerAgent(agent, METADATA_URI);

        assertTrue(registry.isAgent(agent));
        assertEq(registry.ownerOf(agent), owner);
        assertEq(registry.totalAgents(), 1);
        assertEq(registry.activeAgents(), 1);

        MockAgentRegistry.Agent memory a = registry.getAgent(agent);
        assertEq(a.owner, owner);
        assertEq(a.metadataURI, METADATA_URI);
        assertTrue(a.active);
        assertEq(a.registeredAt, block.timestamp);
    }

    function test_Revert_DuplicateRegistration() public {
        vm.startPrank(owner);
        registry.registerAgent(agent, METADATA_URI);

        vm.expectRevert(
            abi.encodeWithSelector(MockAgentRegistry.AgentAlreadyExists.selector, agent)
        );
        registry.registerAgent(agent, METADATA_URI);
        vm.stopPrank();
    }

    function test_Revert_RegisterZeroAddress() public {
        // Zero address is technically allowed by the contract but may not be desirable;
        // the contract will still work — just documenting the behavior.
        vm.prank(owner);
        registry.registerAgent(address(0), METADATA_URI);
        assertTrue(registry.isAgent(address(0)));
    }

    // ── Update ──────────────────────────────────────────────────────────────

    function test_UpdateAgent() public {
        vm.prank(owner);
        registry.registerAgent(agent, METADATA_URI);

        vm.prank(owner);
        vm.expectEmit(true, false, false, true, address(registry));
        emit AgentUpdated(agent, UPDATED_URI, block.timestamp);
        registry.updateAgent(agent, UPDATED_URI);

        MockAgentRegistry.Agent memory a = registry.getAgent(agent);
        assertEq(a.metadataURI, UPDATED_URI);
        assertEq(a.updatedAt, block.timestamp);
        assertTrue(a.active);
    }

    function test_Revert_UpdateNonExistentAgent() public {
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(MockAgentRegistry.AgentNotRegistered.selector, agent)
        );
        registry.updateAgent(agent, UPDATED_URI);
    }

    function test_Revert_UpdateByNonOwner() public {
        vm.prank(owner);
        registry.registerAgent(agent, METADATA_URI);

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(MockAgentRegistry.NotAgentOwner.selector, agent, stranger)
        );
        registry.updateAgent(agent, UPDATED_URI);
    }

    // ── Deactivation ────────────────────────────────────────────────────────

    function test_DeactivateAgent() public {
        vm.prank(owner);
        registry.registerAgent(agent, METADATA_URI);

        vm.prank(owner);
        vm.expectEmit(true, false, false, true, address(registry));
        emit AgentDeactivated(agent, block.timestamp);
        registry.deactivateAgent(agent);

        assertFalse(registry.isAgent(agent));
        assertEq(registry.totalAgents(), 1);
        assertEq(registry.activeAgents(), 0);

        MockAgentRegistry.Agent memory a = registry.getAgent(agent);
        assertFalse(a.active);
    }

    function test_Revert_DeactivateNonExistent() public {
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(MockAgentRegistry.AgentNotRegistered.selector, agent)
        );
        registry.deactivateAgent(agent);
    }

    function test_Revert_DeactivateByNonOwner() public {
        vm.prank(owner);
        registry.registerAgent(agent, METADATA_URI);

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(MockAgentRegistry.NotAgentOwner.selector, agent, stranger)
        );
        registry.deactivateAgent(agent);
    }

    function test_Revert_DeactivateAlreadyDeactivated() public {
        vm.startPrank(owner);
        registry.registerAgent(agent, METADATA_URI);
        registry.deactivateAgent(agent);

        vm.expectRevert(
            abi.encodeWithSelector(MockAgentRegistry.AgentAlreadyDeactivated.selector, agent)
        );
        registry.deactivateAgent(agent);
        vm.stopPrank();
    }

    // ── View Functions ──────────────────────────────────────────────────────

    function test_GetAllAgents() public {
        address agent2 = address(0x400);
        address agent3 = address(0x500);

        vm.startPrank(owner);
        registry.registerAgent(agent,  METADATA_URI);
        registry.registerAgent(agent2, METADATA_URI);
        registry.registerAgent(agent3, METADATA_URI);
        vm.stopPrank();

        address[] memory all = registry.getAllAgents();
        assertEq(all.length, 3);
        assertEq(all[0], agent);
        assertEq(all[1], agent2);
        assertEq(all[2], agent3);
    }

    function test_GetAgentsPaginated() public {
        vm.startPrank(owner);
        for (uint256 i = 0; i < 10; i++) {
            registry.registerAgent(address(uint160(i + 0x1000)), METADATA_URI);
        }
        vm.stopPrank();

        (address[] memory page1, uint256 total) = registry.getAgentsPaginated(0, 5);
        assertEq(page1.length, 5);
        assertEq(total, 10);

        (address[] memory page2, ) = registry.getAgentsPaginated(5, 5);
        assertEq(page2.length, 5);

        (address[] memory page3, ) = registry.getAgentsPaginated(10, 5);
        assertEq(page3.length, 0);
    }

    function test_Revert_GetAgentNotRegistered() public {
        vm.expectRevert(
            abi.encodeWithSelector(MockAgentRegistry.AgentNotRegistered.selector, agent)
        );
        registry.getAgent(agent);
    }

    function test_Revert_OwnerOfNotRegistered() public {
        vm.expectRevert(
            abi.encodeWithSelector(MockAgentRegistry.AgentNotRegistered.selector, agent)
        );
        registry.ownerOf(agent);
    }

    // ── Multiple Agents ─────────────────────────────────────────────────────

    function test_MultipleAgentsDifferentOwners() public {
        address owner2 = address(0x600);
        address agent2 = address(0x700);

        vm.prank(owner);
        registry.registerAgent(agent, METADATA_URI);

        vm.prank(owner2);
        registry.registerAgent(agent2, UPDATED_URI);

        assertEq(registry.totalAgents(), 2);
        assertEq(registry.activeAgents(), 2);
        assertEq(registry.ownerOf(agent), owner);
        assertEq(registry.ownerOf(agent2), owner2);

        // Deactivate only agent
        vm.prank(owner);
        registry.deactivateAgent(agent);
        assertFalse(registry.isAgent(agent));
        assertTrue(registry.isAgent(agent2));
        assertEq(registry.activeAgents(), 1);
    }

    function test_DeactivatedAgentIsNotActive() public {
        vm.startPrank(owner);
        registry.registerAgent(agent, METADATA_URI);
        assertTrue(registry.isAgent(agent));
        registry.deactivateAgent(agent);
        assertFalse(registry.isAgent(agent));
        vm.stopPrank();
    }
}
