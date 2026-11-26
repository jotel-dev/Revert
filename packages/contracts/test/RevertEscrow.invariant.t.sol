// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {RevertEscrow} from "../src/RevertEscrow.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract EscrowHandler is Test {
    RevertEscrow public immutable escrow;
    MockERC20 public immutable usdc;
    address public immutable sender;
    address public immutable recipient;
    uint256 public immutable attestorPk;
    address public immutable attestor;

    uint256[] public escrowIds;
    uint256 public expectedLocked;
    uint256 public totalDeposited;
    uint256 public totalReleased;
    uint256 public totalRefunded;
    uint256 public nonceSeq;

    mapping(uint256 => RevertEscrow.Escrow) public initialSnapshots;

    constructor(
        RevertEscrow escrow_,
        MockERC20 usdc_,
        address sender_,
        address recipient_,
        uint256 attestorPk_
    ) {
        escrow = escrow_;
        usdc = usdc_;
        sender = sender_;
        recipient = recipient_;
        attestorPk = attestorPk_;
        attestor = vm.addr(attestorPk_);
    }

    function createProtected(uint96 rawAmount, uint32 rawDuration) external {
        uint256 amount = bound(uint256(rawAmount), 1, 1_000_000);
        uint64 duration = uint64(bound(uint256(rawDuration), 60, 7 days));
        usdc.mint(sender, amount);

        vm.startPrank(sender);
        usdc.approve(address(escrow), amount);
        uint256 id = escrow.createProtectedEscrow(
            recipient,
            address(usdc),
            amount,
            uint64(vm.getBlockTimestamp()) + duration
        );
        vm.stopPrank();

        escrowIds.push(id);
        initialSnapshots[id] = escrow.getEscrow(id);
        expectedLocked += amount;
        totalDeposited += amount;
    }

    function createConditional(uint96 rawAmount, uint32 rawDuration) external {
        uint256 amount = bound(uint256(rawAmount), 1, 1_000_000);
        uint64 duration = uint64(bound(uint256(rawDuration), 60, 7 days));
        usdc.mint(sender, amount);

        vm.startPrank(sender);
        usdc.approve(address(escrow), amount);
        uint256 id = escrow.createConditionalEscrow(
            recipient,
            address(usdc),
            amount,
            uint64(vm.getBlockTimestamp()) + duration,
            keccak256(abi.encodePacked("cond", idSeed())),
            attestor
        );
        vm.stopPrank();

        escrowIds.push(id);
        initialSnapshots[id] = escrow.getEscrow(id);
        expectedLocked += amount;
        totalDeposited += amount;
    }

    function cancelProtected(uint256 seed) external {
        if (escrowIds.length == 0) return;
        uint256 id = escrowIds[seed % escrowIds.length];
        RevertEscrow.Escrow memory e = escrow.getEscrow(id);
        if (
            e.mode != RevertEscrow.Mode.Protected ||
            e.state != RevertEscrow.State.LOCKED ||
            vm.getBlockTimestamp() >= e.recoveryWindowEnd
        ) return;

        vm.prank(sender);
        escrow.cancelProtected(id);
        expectedLocked -= e.amount;
        totalRefunded += e.amount;
    }

    function claimProtected(uint256 seed) external {
        if (escrowIds.length == 0) return;
        uint256 id = escrowIds[seed % escrowIds.length];
        RevertEscrow.Escrow memory e = escrow.getEscrow(id);
        if (
            e.mode != RevertEscrow.Mode.Protected ||
            e.state != RevertEscrow.State.LOCKED ||
            vm.getBlockTimestamp() < e.recoveryWindowEnd
        ) return;

        vm.prank(recipient);
        escrow.claimProtected(id);
        expectedLocked -= e.amount;
        totalReleased += e.amount;
    }

    function settleConditional(uint256 seed, bool releasePath) external {
        if (escrowIds.length == 0) return;
        uint256 id = escrowIds[seed % escrowIds.length];
        RevertEscrow.Escrow memory e = escrow.getEscrow(id);
        uint64 nowTs = uint64(vm.getBlockTimestamp());
        if (
            e.mode != RevertEscrow.Mode.Conditional ||
            e.state != RevertEscrow.State.LOCKED ||
            nowTs > e.deadline
        ) return;

        nonceSeq++;
        RevertEscrow.SettlementOutcome outcome = releasePath
            ? RevertEscrow.SettlementOutcome.RELEASE
            : RevertEscrow.SettlementOutcome.REFUND;
        RevertEscrow.SettlementAttestationInput memory input = RevertEscrow.SettlementAttestationInput({
            escrowId: id,
            outcome: outcome,
            evidenceHash: keccak256("e"),
            signalHash: keccak256("s"),
            receiptHash: keccak256("r"),
            nonce: bytes32(nonceSeq),
            issuedAt: nowTs,
            expiresAt: nowTs + 10 minutes
        });
        bytes32 digest = escrow.hashSettlementAttestation(input, e.conditionHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attestorPk, digest);

        escrow.settleConditional(input, abi.encodePacked(r, s, v));
        expectedLocked -= e.amount;
        if (releasePath) totalReleased += e.amount;
        else totalRefunded += e.amount;
    }

    function refundExpired(uint256 seed) external {
        if (escrowIds.length == 0) return;
        uint256 id = escrowIds[seed % escrowIds.length];
        RevertEscrow.Escrow memory e = escrow.getEscrow(id);
        if (
            e.mode != RevertEscrow.Mode.Conditional ||
            e.state != RevertEscrow.State.LOCKED ||
            vm.getBlockTimestamp() <= e.deadline
        ) return;

        escrow.refundExpired(id);
        expectedLocked -= e.amount;
        totalRefunded += e.amount;
    }

    function warpTime(uint32 delta) external {
        uint256 step = bound(uint256(delta), 1, 2 days);
        vm.warp(vm.getBlockTimestamp() + step);
    }

    function escrowCount() external view returns (uint256) {
        return escrowIds.length;
    }

    function getInitialSnapshot(uint256 id) external view returns (RevertEscrow.Escrow memory) {
        return initialSnapshots[id];
    }

    function idSeed() private returns (uint256) {
        return ++nonceSeq;
    }
}

contract RevertEscrowInvariantTest is StdInvariant, Test {
    RevertEscrow internal escrow;
    MockERC20 internal usdc;
    EscrowHandler internal handler;

    function setUp() public {
        address owner = makeAddr("owner");
        address sender = makeAddr("sender");
        address recipient = makeAddr("recipient");

        usdc = new MockERC20("USD Coin", "USDC", 6);
        address[] memory tokens = new address[](1);
        tokens[0] = address(usdc);
        escrow = new RevertEscrow(owner, tokens);

        handler = new EscrowHandler(escrow, usdc, sender, recipient, 0xA11CE);
        targetContract(address(handler));
    }

    function invariant_ConservationOfEscrowedFunds() public view {
        uint256 contractBalance = usdc.balanceOf(address(escrow));
        assertEq(contractBalance, handler.expectedLocked());
        assertEq(
            handler.totalDeposited(),
            contractBalance + handler.totalReleased() + handler.totalRefunded()
        );
    }

    function invariant_ImmutableTermsPreserved() public view {
        uint256 count = handler.escrowCount();
        for (uint256 i = 0; i < count; i++) {
            uint256 id = handler.escrowIds(i);
            RevertEscrow.Escrow memory current = escrow.getEscrow(id);
            RevertEscrow.Escrow memory initial = handler.getInitialSnapshot(id);
            assertEq(uint8(current.mode), uint8(initial.mode));
            assertEq(current.sender, initial.sender);
            assertEq(current.recipient, initial.recipient);
            assertEq(current.token, initial.token);
            assertEq(current.amount, initial.amount);
            assertEq(current.recoveryWindowEnd, initial.recoveryWindowEnd);
            assertEq(current.deadline, initial.deadline);
            assertEq(current.conditionHash, initial.conditionHash);
            assertEq(current.attestor, initial.attestor);
        }
    }
}
