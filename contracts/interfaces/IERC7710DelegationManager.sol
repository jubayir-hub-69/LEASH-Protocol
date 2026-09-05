// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IERC7710DelegationManager
/// @notice Minimal surface used by LEASH to revoke an ERC-7710 delegation.
/// @dev Production integrations should wrap the MetaMask Delegation Framework
///      `disableDelegation(Delegation)` call behind this hash-based adapter.
interface IERC7710DelegationManager {
    /// @notice Disable a previously granted ERC-7710 delegation.
    /// @param delegationHash Identifier of the delegation to revoke.
    function disableDelegation(bytes32 delegationHash) external;
}
