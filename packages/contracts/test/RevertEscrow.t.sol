// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {RevertEscrow} from "../src/RevertEscrow.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract RevertEscrowTest is Test {
    RevertEscrow internal escrow;
    MockERC20 internal usdc;
    MockERC20 internal unallowedToken;

    address internal owner = makeAddr("owner");
    address internal sender = makeAddr("sender");
    address internal recipient = makeAddr("recipient");
    address internal stranger = makeAddr("stranger");

    uint256 internal attestorPk = 0xA11CE;
    address internal attestor;

    bytes32 internal constant COND_HASH = keccak256("condition-v1");
    bytes32 internal constant EVID_HASH = keccak256("evidence-v1");
    bytes32 internal constant SIG_HASH = keccak256("signal-v1");
    bytes32 internal constant RCPT_HASH = keccak256("receipt-v1");

    function setUp() public {
        attestor = vm.addr(attestorPk);
        usdc = new MockERC20("USD Coin", "USDC", 6);
        unallowedToken = new MockERC20("Unallowed", "BAD", 6);

        address[] memory tokens = new address[](1);
        tokens[0] = address(usdc);
        escrow = new RevertEscrow(owner, tokens);

        usdc.mint(sender, 1_000_000_000); // 1,000 USDC
        unallowedToken.mint(sender, 1_000_000_000);

        vm.prank(sender);
        usdc.approve(address(escrow), type(uint256).max);

        vm.prank(sender);
        unallowedToken.approve(address(escrow), type(uint256).max);
    }

    function test_ProtectedEscrow_CancelBeforeWindow() public {
        uint64 windowEnd = uint64(block.timestamp + 1 hours);
        vm.prank(sender);
        uint256 id = escrow.createProtectedEscrow(recipient, address(usdc), 5_000_000, windowEnd);

        assertEq(usdc.balanceOf(address(escrow)), 5_000_000);

        vm.prank(sender);
        escrow.cancelProtected(id);

        assertEq(usdc.balanceOf(sender), 1_000_000_000);
        assertEq(uint8(escrow.getEscrow(id).state), uint8(RevertEscrow.State.REFUNDED));

        vm.prank(recipient);
        vm.warp(windowEnd);
        vm.expectRevert(
            abi.encodeWithSelector(RevertEscrow.EscrowNotLocked.selector, RevertEscrow.State.REFUNDED)
        );
        escrow.claimProtected(id);
    }

    function test_ProtectedEscrow_ClaimAtOrAfterWindow() public {
        uint64 windowEnd = uint64(block.timestamp + 1 hours);
        vm.prank(sender);
        uint256 id = escrow.createProtectedEscrow(recipient, address(usdc), 5_000_000, windowEnd);

        vm.prank(recipient);
        vm.expectRevert(
            abi.encodeWithSelector(
                RevertEscrow.RecoveryWindowActive.selector,
                windowEnd,
                uint64(block.timestamp)
            )
        );
        escrow.claimProtected(id);

        vm.warp(windowEnd);
        vm.prank(sender);
        vm.expectRevert(
            abi.encodeWithSelector(
                RevertEscrow.RecoveryWindowExpired.selector,
                windowEnd,
                uint64(block.timestamp)
            )
        );
        escrow.cancelProtected(id);

        vm.prank(recipient);
        escrow.claimProtected(id);

        assertEq(usdc.balanceOf(recipient), 5_000_000);
        assertEq(uint8(escrow.getEscrow(id).state), uint8(RevertEscrow.State.RELEASED));

        // Double claim fails
        vm.prank(recipient);
        vm.expectRevert(
            abi.encodeWithSelector(RevertEscrow.EscrowNotLocked.selector, RevertEscrow.State.RELEASED)
        );
        escrow.claimProtected(id);
    }

    function test_ConditionalEscrow_SettleWithValidAttestation() public {
        uint64 deadline = uint64(block.timestamp + 2 hours);
        vm.prank(sender);
        uint256 id = escrow.createConditionalEscrow(
            recipient,
            address(usdc),
            10_000_000,
            deadline,
            COND_HASH,
            attestor
        );

        uint64 expiresAt = uint64(block.timestamp + 30 minutes);
        bytes memory sig = _signAttestation(
            attestorPk,
            id,
            COND_HASH,
            EVID_HASH,
            SIG_HASH,
            RCPT_HASH,
            expiresAt
        );

        vm.prank(stranger);
        escrow.settleConditional(id, EVID_HASH, SIG_HASH, RCPT_HASH, expiresAt, sig);

        assertEq(usdc.balanceOf(recipient), 10_000_000);
        assertEq(uint8(escrow.getEscrow(id).state), uint8(RevertEscrow.State.RELEASED));

        // Replay / double settlement fails
        vm.expectRevert(
            abi.encodeWithSelector(RevertEscrow.EscrowNotLocked.selector, RevertEscrow.State.RELEASED)
        );
        escrow.settleConditional(id, EVID_HASH, SIG_HASH, RCPT_HASH, expiresAt, sig);
    }

    function test_ConditionalEscrow_RejectsInvalidSignerOrExpiredAttestation() public {
        uint64 deadline = uint64(block.timestamp + 2 hours);
        vm.prank(sender);
        uint256 id = escrow.createConditionalEscrow(
            recipient,
            address(usdc),
            10_000_000,
            deadline,
            COND_HASH,
            attestor
        );

        uint64 expiresAt = uint64(block.timestamp + 10 minutes);
        bytes memory badSig = _signAttestation(
            0xBAD,
            id,
            COND_HASH,
            EVID_HASH,
            SIG_HASH,
            RCPT_HASH,
            expiresAt
        );

        vm.expectRevert(RevertEscrow.InvalidAttestorSignature.selector);
        escrow.settleConditional(id, EVID_HASH, SIG_HASH, RCPT_HASH, expiresAt, badSig);

        bytes memory goodSig = _signAttestation(
            attestorPk,
            id,
            COND_HASH,
            EVID_HASH,
            SIG_HASH,
            RCPT_HASH,
            expiresAt
        );
        vm.warp(expiresAt + 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                RevertEscrow.AttestationExpired.selector,
                expiresAt,
                uint64(block.timestamp)
            )
        );
        escrow.settleConditional(id, EVID_HASH, SIG_HASH, RCPT_HASH, expiresAt, goodSig);
    }

    function test_ConditionalEscrow_RejectsZeroProofHashes() public {
        uint64 deadline = uint64(block.timestamp + 2 hours);
        vm.prank(sender);
        uint256 id = escrow.createConditionalEscrow(
            recipient,
            address(usdc),
            10_000_000,
            deadline,
            COND_HASH,
            attestor
        );
        uint64 expiresAt = uint64(block.timestamp + 10 minutes);
        bytes memory sig = _signAttestation(
            attestorPk,
            id,
            COND_HASH,
            bytes32(0),
            SIG_HASH,
            RCPT_HASH,
            expiresAt
        );

        vm.expectRevert(RevertEscrow.InvalidProofHash.selector);
        escrow.settleConditional(id, bytes32(0), SIG_HASH, RCPT_HASH, expiresAt, sig);
    }

    function test_ConditionalEscrow_RefundAfterDeadline() public {
        uint64 deadline = uint64(block.timestamp + 2 hours);
        vm.prank(sender);
        uint256 id = escrow.createConditionalEscrow(
            recipient,
            address(usdc),
            10_000_000,
            deadline,
            COND_HASH,
            attestor
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                RevertEscrow.DeadlineNotReached.selector,
                deadline,
                uint64(block.timestamp)
            )
        );
        escrow.refundExpired(id);

        vm.warp(deadline + 1);
        escrow.refundExpired(id);

        assertEq(usdc.balanceOf(sender), 1_000_000_000);
        assertEq(uint8(escrow.getEscrow(id).state), uint8(RevertEscrow.State.REFUNDED));
    }

    function test_RejectsUnallowedTokenAndModeConfusion() public {
        vm.prank(sender);
        vm.expectRevert(
            abi.encodeWithSelector(RevertEscrow.TokenNotAllowed.selector, address(unallowedToken))
        );
        escrow.createProtectedEscrow(recipient, address(unallowedToken), 100, uint64(block.timestamp + 1 hours));

        vm.prank(sender);
        uint256 id = escrow.createProtectedEscrow(recipient, address(usdc), 100, uint64(block.timestamp + 1 hours));

        vm.expectRevert(
            abi.encodeWithSelector(
                RevertEscrow.InvalidMode.selector,
                RevertEscrow.Mode.Protected,
                RevertEscrow.Mode.Conditional
            )
        );
        escrow.refundExpired(id);
    }

    function testFuzz_ProtectedEscrow_NeverDoubleSettles(uint96 rawAmount, uint32 rawDuration, bool cancelPath) public {
        uint256 amount = bound(uint256(rawAmount), 1, 1_000_000_000);
        uint64 duration = uint64(bound(uint256(rawDuration), 1, 30 days));
        uint64 windowEnd = uint64(block.timestamp) + duration;

        uint256 balBefore = usdc.balanceOf(sender);
        vm.prank(sender);
        uint256 id = escrow.createProtectedEscrow(recipient, address(usdc), amount, windowEnd);

        if (cancelPath) {
            vm.prank(sender);
            escrow.cancelProtected(id);
            assertEq(usdc.balanceOf(sender), balBefore);
            assertEq(usdc.balanceOf(address(escrow)), 0);
        } else {
            vm.warp(windowEnd);
            vm.prank(recipient);
            escrow.claimProtected(id);
            assertEq(usdc.balanceOf(recipient), amount);
            assertEq(usdc.balanceOf(address(escrow)), 0);
        }
    }

    function _signAttestation(
        uint256 pk,
        uint256 escrowId,
        bytes32 conditionHash,
        bytes32 evidenceHash,
        bytes32 signalHash,
        bytes32 receiptHash,
        uint64 expiresAt
    ) internal view returns (bytes memory) {
        bytes32 digest = escrow.hashSettlementAttestation(
            escrowId,
            conditionHash,
            evidenceHash,
            signalHash,
            receiptHash,
            expiresAt
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }
}
