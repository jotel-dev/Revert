// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IRevertEscrowHook {
    function claimProtected(uint256 escrowId) external;
    function cancelProtected(uint256 escrowId) external;
}

contract ReentrantMockERC20 is ERC20 {
    address public targetEscrow;
    uint256 public targetId;
    bool public attackOnTransfer;

    constructor() ERC20("Reentrant Token", "REENT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function armAttack(address escrow_, uint256 id_, bool active_) external {
        targetEscrow = escrow_;
        targetId = id_;
        attackOnTransfer = active_;
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        if (attackOnTransfer && msg.sender == targetEscrow) {
            attackOnTransfer = false;
            IRevertEscrowHook(targetEscrow).claimProtected(targetId);
        }
        return super.transfer(to, value);
    }
}
