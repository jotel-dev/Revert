// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {RevertEscrow} from "../src/RevertEscrow.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {FeeOnTransferMockERC20} from "./mocks/FeeOnTransferMockERC20.sol";
import {ReentrantMockERC20} from "./mocks/ReentrantMockERC20.sol";

contract RevertEscrowTest is Test {
    RevertEscrow internal escrow;
    MockERC20 internal usdc;
    MockERC20 internal unallowedToken;
    FeeOnTransferMockERC20 internal feeToken;
    ReentrantMockERC20 internal reentrantToken;

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
    bytes32 internal constant NONCE_1 = keccak256("nonce-1");

    function setUp() public {
        attestor = vm.addr(attestorPk);
        usdc = new MockERC20("USD Coin", "USDC", 6);
        unallowedToken = new MockERC20("Unallowed", "BAD", 6);
        feeToken = new FeeOnTransferMockERC20();
        reentrantToken = new ReentrantMockERC20();

        address[] memory tokens = new address[](3);
        tokens[0] = address(usdc);
        tokens[1] = address(feeToken);
        tokens[2] = address(reentrantToken);
        escrow = new RevertEscrow(owner, tokens);

        usdc.mint(sender, 1_000_000_000);
        unallowedToken.mint(sender, 1_000_000_000);
        feeToken.mint(sender, 1_000_000_000);
        reentrantToken.mint(sender, 1_000_000_000);

        vm.startPrank(sender);
        usdc.approve(address(escrow), type(uint256).max);
        unallowedToken.approve(address(escrow), type(uint256).max);
        feeToken.approve(address(escrow), type(uint256).max);
        reentrantToken.approve(address(escrow), type(uint256).max);
        vm.stopPrank();
    }

    function test_ProtectedEscrow_CancelBeforeWindow() public {
        uint64 windowEnd = uint64(vm.getBlockTimestamp() + 1 hours);
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

    function test_ProtectedEscrow_ClaimAtOrAfterWindowBoundary() public {
        uint64 startTs = uint64(vm.getBlockTimestamp());
        uint64 windowEnd = startTs + 1 hours;
        vm.prank(sender);
        uint256 id = escrow.createProtectedEscrow(recipient, address(usdc), 5_000_000, windowEnd);

        vm.prank(recipient);
        vm.expectRevert(
            abi.encodeWithSelector(
                RevertEscrow.RecoveryWindowActive.selector,
                windowEnd,
                startTs
            )
        );
        escrow.claimProtected(id);

        vm.warp(windowEnd);
        vm.prank(sender);
        vm.expectRevert(
            abi.encodeWithSelector(
                RevertEscrow.RecoveryWindowExpired.selector,
                windowEnd,
                windowEnd
            )
        );
        escrow.cancelProtected(id);

        vm.prank(recipient);
        escrow.claimProtected(id);

        assertEq(usdc.balanceOf(recipient), 5_000_000);
        assertEq(uint8(escrow.getEscrow(id).state), uint8(RevertEscrow.State.RELEASED));

        vm.prank(recipient);
        vm.expectRevert(
            abi.encodeWithSelector(RevertEscrow.EscrowNotLocked.selector, RevertEscrow.State.RELEASED)
        );
        escrow.claimProtected(id);
    }

    function test_ConditionalEscrow_SettleReleaseAndPreventReplay() public {
        uint64 nowTs = uint64(vm.getBlockTimestamp());
        uint64 deadline = nowTs + 2 hours;
        vm.prank(sender);
        uint256 id = escrow.createConditionalEscrow(
            recipient,
            address(usdc),
            10_000_000,
            deadline,
            COND_HASH,
            attestor
        );

        RevertEscrow.SettlementAttestationInput memory input = RevertEscrow.SettlementAttestationInput({
            escrowId: id,
            outcome: RevertEscrow.SettlementOutcome.RELEASE,
            evidenceHash: EVID_HASH,
            signalHash: SIG_HASH,
            receiptHash: RCPT_HASH,
            nonce: NONCE_1,
            issuedAt: nowTs,
            expiresAt: nowTs + 30 minutes
        });
        bytes memory sig = _signAttestation(attestorPk, input, COND_HASH);

        vm.prank(stranger);
        escrow.settleConditional(input, sig);

        assertEq(usdc.balanceOf(recipient), 10_000_000);
        assertEq(uint8(escrow.getEscrow(id).state), uint8(RevertEscrow.State.RELEASED));

        vm.expectRevert(
            abi.encodeWithSelector(RevertEscrow.EscrowNotLocked.selector, RevertEscrow.State.RELEASED)
        );
        escrow.settleConditional(input, sig);
    }

    function test_ConditionalEscrow_SettleRefundOutcome() public {
        uint64 nowTs = uint64(vm.getBlockTimestamp());
        vm.prank(sender);
        uint256 id = escrow.createConditionalEscrow(
            recipient,
            address(usdc),
            10_000_000,
            nowTs + 2 hours,
            COND_HASH,
            attestor
        );

        RevertEscrow.SettlementAttestationInput memory input = RevertEscrow.SettlementAttestationInput({
            escrowId: id,
            outcome: RevertEscrow.SettlementOutcome.REFUND,
            evidenceHash: EVID_HASH,
            signalHash: SIG_HASH,
            receiptHash: RCPT_HASH,
            nonce: NONCE_1,
            issuedAt: nowTs,
            expiresAt: nowTs + 30 minutes
        });
        bytes memory sig = _signAttestation(attestorPk, input, COND_HASH);

        escrow.settleConditional(input, sig);
        assertEq(usdc.balanceOf(sender), 1_000_000_000);
        assertEq(uint8(escrow.getEscrow(id).state), uint8(RevertEscrow.State.REFUNDED));
    }

    function test_ConditionalEscrow_RejectsWrongEscrowBindingAndNonceReplay() public {
        uint64 nowTs = uint64(vm.getBlockTimestamp());
        vm.startPrank(sender);
        uint256 id1 = escrow.createConditionalEscrow(
            recipient,
            address(usdc),
            5_000_000,
            nowTs + 2 hours,
            COND_HASH,
            attestor
        );
        uint256 id2 = escrow.createConditionalEscrow(
            recipient,
            address(usdc),
            5_000_000,
            nowTs + 2 hours,
            COND_HASH,
            attestor
        );
        vm.stopPrank();

        // Sign for id1, submit against id2 -> wrong payment binding
        RevertEscrow.SettlementAttestationInput memory inputFor1 = RevertEscrow.SettlementAttestationInput({
            escrowId: id1,
            outcome: RevertEscrow.SettlementOutcome.RELEASE,
            evidenceHash: EVID_HASH,
            signalHash: SIG_HASH,
            receiptHash: RCPT_HASH,
            nonce: NONCE_1,
            issuedAt: nowTs,
            expiresAt: nowTs + 30 minutes
        });
        bytes memory sigFor1 = _signAttestation(attestorPk, inputFor1, COND_HASH);

        RevertEscrow.SettlementAttestationInput memory wrongBindingInput = RevertEscrow
            .SettlementAttestationInput({
                escrowId: id2,
                outcome: RevertEscrow.SettlementOutcome.RELEASE,
                evidenceHash: EVID_HASH,
                signalHash: SIG_HASH,
                receiptHash: RCPT_HASH,
                nonce: NONCE_1,
                issuedAt: nowTs,
                expiresAt: nowTs + 30 minutes
            });
        vm.expectRevert(RevertEscrow.InvalidAttestorSignature.selector);
        escrow.settleConditional(wrongBindingInput, sigFor1);

        // Settle id1 legitimately, then try reusing NONCE_1 on id2
        escrow.settleConditional(inputFor1, sigFor1);

        bytes memory sigFor2SameNonce = _signAttestation(attestorPk, wrongBindingInput, COND_HASH);
        vm.expectRevert(
            abi.encodeWithSelector(RevertEscrow.NonceAlreadyUsed.selector, attestor, NONCE_1)
        );
        escrow.settleConditional(wrongBindingInput, sigFor2SameNonce);
    }

    function test_ConditionalEscrow_RejectsStaleExpiredAndInvalidSigner() public {
        uint64 nowTs = uint64(vm.getBlockTimestamp());
        vm.prank(sender);
        uint256 id = escrow.createConditionalEscrow(
            recipient,
            address(usdc),
            10_000_000,
            nowTs + 2 days,
            COND_HASH,
            attestor
        );

        // Bad signer
        RevertEscrow.SettlementAttestationInput memory input = RevertEscrow.SettlementAttestationInput({
            escrowId: id,
            outcome: RevertEscrow.SettlementOutcome.RELEASE,
            evidenceHash: EVID_HASH,
            signalHash: SIG_HASH,
            receiptHash: RCPT_HASH,
            nonce: NONCE_1,
            issuedAt: nowTs,
            expiresAt: nowTs + 10 minutes
        });
        bytes memory badSig = _signAttestation(0xBAD, input, COND_HASH);
        vm.expectRevert(RevertEscrow.InvalidAttestorSignature.selector);
        escrow.settleConditional(input, badSig);

        // Stale attestation TTL > MAX_ATTESTATION_TTL (1 day)
        RevertEscrow.SettlementAttestationInput memory staleInput = RevertEscrow
            .SettlementAttestationInput({
                escrowId: id,
                outcome: RevertEscrow.SettlementOutcome.RELEASE,
                evidenceHash: EVID_HASH,
                signalHash: SIG_HASH,
                receiptHash: RCPT_HASH,
                nonce: NONCE_1,
                issuedAt: nowTs,
                expiresAt: nowTs + 2 days
            });
        bytes memory staleSig = _signAttestation(attestorPk, staleInput, COND_HASH);
        vm.expectRevert(
            abi.encodeWithSelector(
                RevertEscrow.StaleOrFutureAttestation.selector,
                staleInput.issuedAt,
                staleInput.expiresAt,
                nowTs
            )
        );
        escrow.settleConditional(staleInput, staleSig);

        // Expired attestation
        bytes memory goodSig = _signAttestation(attestorPk, input, COND_HASH);
        uint64 expiredTs = input.expiresAt + 1;
        vm.warp(expiredTs);
        vm.expectRevert(
            abi.encodeWithSelector(
                RevertEscrow.AttestationExpired.selector,
                input.expiresAt,
                expiredTs
            )
        );
        escrow.settleConditional(input, goodSig);
    }

    function test_ConditionalEscrow_RejectsZeroProofHashesAndDeadlineBoundary() public {
        uint64 nowTs = uint64(vm.getBlockTimestamp());
        uint64 deadline = nowTs + 2 hours;
        vm.prank(sender);
        uint256 id = escrow.createConditionalEscrow(
            recipient,
            address(usdc),
            10_000_000,
            deadline,
            COND_HASH,
            attestor
        );

        RevertEscrow.SettlementAttestationInput memory zeroProof = RevertEscrow.SettlementAttestationInput({
            escrowId: id,
            outcome: RevertEscrow.SettlementOutcome.RELEASE,
            evidenceHash: bytes32(0),
            signalHash: SIG_HASH,
            receiptHash: RCPT_HASH,
            nonce: NONCE_1,
            issuedAt: nowTs,
            expiresAt: nowTs + 10 minutes
        });
        bytes memory sig = _signAttestation(attestorPk, zeroProof, COND_HASH);

        vm.expectRevert(RevertEscrow.InvalidProofHash.selector);
        escrow.settleConditional(zeroProof, sig);

        // At exact deadline, refundExpired reverts
        vm.warp(deadline);
        vm.expectRevert(
            abi.encodeWithSelector(RevertEscrow.DeadlineNotReached.selector, deadline, deadline)
        );
        escrow.refundExpired(id);

        // After deadline, settleConditional reverts and refundExpired succeeds
        uint64 pastDeadline = deadline + 1;
        vm.warp(pastDeadline);
        RevertEscrow.SettlementAttestationInput memory lateInput = zeroProof;
        lateInput.evidenceHash = EVID_HASH;
        lateInput.issuedAt = pastDeadline;
        lateInput.expiresAt = pastDeadline + 5 minutes;
        bytes memory lateSig = _signAttestation(attestorPk, lateInput, COND_HASH);

        vm.expectRevert(
            abi.encodeWithSelector(RevertEscrow.DeadlineExpired.selector, deadline, pastDeadline)
        );
        escrow.settleConditional(lateInput, lateSig);

        escrow.refundExpired(id);
        assertEq(usdc.balanceOf(sender), 1_000_000_000);
        assertEq(uint8(escrow.getEscrow(id).state), uint8(RevertEscrow.State.REFUNDED));
    }

    function test_RejectsInvalidTokensFeeOnTransferAndReentrancy() public {
        // Non-contract token address cannot be allowlisted
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(RevertEscrow.InvalidTokenContract.selector, stranger));
        escrow.setAllowedToken(stranger, true);

        // Unallowed token rejected
        vm.prank(sender);
        vm.expectRevert(
            abi.encodeWithSelector(RevertEscrow.TokenNotAllowed.selector, address(unallowedToken))
        );
        escrow.createProtectedEscrow(
            recipient,
            address(unallowedToken),
            100,
            uint64(vm.getBlockTimestamp() + 1 hours)
        );

        // Fee-on-transfer token rejected
        vm.prank(sender);
        vm.expectRevert(RevertEscrow.FeeOnTransferUnsupported.selector);
        escrow.createProtectedEscrow(
            recipient,
            address(feeToken),
            10_000,
            uint64(vm.getBlockTimestamp() + 1 hours)
        );

        // Reentrancy via malicious ERC-20 transfer rejected
        uint64 windowEnd = uint64(vm.getBlockTimestamp() + 1 hours);
        vm.prank(sender);
        uint256 id = escrow.createProtectedEscrow(
            recipient,
            address(reentrantToken),
            10_000,
            windowEnd
        );
        vm.warp(windowEnd);
        reentrantToken.armAttack(address(escrow), id, true);

        vm.prank(recipient);
        vm.expectRevert(); // ReentrancyGuardReentrantCall
        escrow.claimProtected(id);
    }

    function testFuzz_ProtectedEscrow_NeverDoubleSettles(
        uint96 rawAmount,
        uint32 rawDuration,
        bool cancelPath
    ) public {
        uint256 amount = bound(uint256(rawAmount), 1, 1_000_000_000);
        uint64 duration = uint64(bound(uint256(rawDuration), 1, 30 days));
        uint64 windowEnd = uint64(vm.getBlockTimestamp()) + duration;

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
        RevertEscrow.SettlementAttestationInput memory input,
        bytes32 conditionHash
    ) internal view returns (bytes memory) {
        bytes32 digest = escrow.hashSettlementAttestation(input, conditionHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }
}
