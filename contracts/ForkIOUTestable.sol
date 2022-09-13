// SPDX-License-Identifier: WTFPL
pragma solidity ^0.8.9;

import "./ForkIOU.sol";

/// @title ForkIOUTestable
/// @author D3Y3R, Kyoko Kirigiri
/// @notice Contract to test block.chainid and block.difficulty changes pre and post-fork
contract ForkIOUTestable is ForkIOU {
    /// @notice Mock state variable to replace block.chainid
    uint256 testChainId = 1;

    /// @notice Mock state variable to replace block.difficulty
    uint256 testDifficulty = 2**64/2;

    constructor() {}

    /// @notice Mock view function to override virtual function that would normally read block.chainid directly
    /// @return Mock chainid
    function getChainId() public override view returns (uint256) {
        return testChainId;
    }

    /// @notice Mock view function to override virtual function that would normally read block.difficulty directly
    /// @return Mock difficulty
    function getBlockDifficulty() public override view returns (uint256) {
        return testDifficulty;
    }

    /// @notice Mock switching to PoW chain by setting a new chainid
    function switchToPowChain() external {
        testChainId = 10001;
    }

    /// @notice Mock activating merge on mainnet by setting difficulty high
    function activateMainnetMerge() external {
        testDifficulty = 2**256-1;
    }
}
