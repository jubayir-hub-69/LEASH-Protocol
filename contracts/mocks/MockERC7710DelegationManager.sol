// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC7710DelegationManager} from "../interfaces/IERC7710DelegationManager.sol";

/// @title MockERC7710DelegationManager
/// @notice Local stand-in for an ERC-7710 delegation manager so Revoke can be demoed.
contract MockERC7710DelegationManager is IERC7710DelegationManager {
    mapping(bytes32 => bool) public disabled;

    event DelegationDisabled(bytes32 indexed delegationHash, address indexed caller);

    function disableDelegation(bytes32 delegationHash) external {
        disabled[delegationHash] = true;
        emit DelegationDisabled(delegationHash, msg.sender);
    }
}
