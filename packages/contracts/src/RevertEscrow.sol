// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/**
 * @title RevertEscrow
 * @notice Programmable payment recovery (Mode A) and evidence-based conditional
 *         settlement (Mode B) escrow for allowlisted ERC-20 tokens.
 * @dev Mode B relies on an immutable per-escrow EIP-712 attestor address chosen
 *      at funding time. The attestor can only trigger settlement to the immutable
 *      recipient (RELEASE) or refund to the immutable sender (REFUND) before the
 *      escrow deadline, bound to chainId, verifyingContract, escrowId,
 *      conditionHash, outcome, evidence/signal/receipt hashes, nonce, and expiry.
 *      This centralized attestor model is explicitly not trustless; post-deadline
 *      permissionless refunds guarantee funds cannot be trapped if the attestor
 *      or Telegraph intelligence service becomes unavailable.
 */
contract RevertEscrow is Ownable2Step, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    enum Mode {
        Protected,
        Conditional
    }

    enum State {
        LOCKED,
        RELEASED,
        REFUNDED
    }

    enum SettlementOutcome {
        NONE,
        RELEASE,
        REFUND
    }

    struct Escrow {
        Mode mode;
        State state;
        address sender;
        address recipient;
        address token;
        uint256 amount;
        uint64 createdAt;
        uint64 recoveryWindowEnd;
        uint64 deadline;
        bytes32 conditionHash;
        address attestor;
    }

    struct SettlementAttestationInput {
        uint256 escrowId;
        SettlementOutcome outcome;
        bytes32 evidenceHash;
        bytes32 signalHash;
        bytes32 receiptHash;
        bytes32 nonce;
        uint64 issuedAt;
        uint64 expiresAt;
    }

    bytes32 public constant SETTLEMENT_ATTESTATION_TYPEHASH = keccak256(
        "SettlementAttestation(uint256 escrowId,bytes32 conditionHash,uint8 outcome,bytes32 evidenceHash,bytes32 signalHash,bytes32 receiptHash,bytes32 nonce,uint64 issuedAt,uint64 expiresAt)"
    );

    uint64 public constant MAX_ESCROW_DURATION = 365 days;
    uint64 public constant MAX_ATTESTATION_TTL = 1 days;

    uint256 public nextEscrowId = 1;
    mapping(address => bool) public allowedTokens;
    mapping(uint256 => Escrow) private _escrows;
    mapping(bytes32 => bool) public usedAttestations;
    mapping(address => mapping(bytes32 => bool)) public usedNonces;

    event TokenAllowlistUpdated(address indexed token, bool allowed);

    event ProtectedEscrowCreated(
        uint256 indexed escrowId,
        address indexed sender,
        address indexed recipient,
        address token,
        uint256 amount,
        uint64 recoveryWindowEnd
    );

    event ConditionalEscrowCreated(
        uint256 indexed escrowId,
        address indexed sender,
        address indexed recipient,
        address token,
        uint256 amount,
        uint64 deadline,
        bytes32 conditionHash,
        address attestor
    );

    event EscrowReleased(
        uint256 indexed escrowId,
        Mode mode,
        address indexed recipient,
        address token,
        uint256 amount,
        bytes32 evidenceHash,
        bytes32 signalHash,
        bytes32 receiptHash
    );

    event EscrowRefunded(
        uint256 indexed escrowId,
        Mode mode,
        address indexed sender,
        address token,
        uint256 amount,
        bytes32 evidenceHash,
        bytes32 signalHash,
        bytes32 receiptHash
    );

    error ZeroAddress();
    error InvalidAmount();
    error TokenNotAllowed(address token);
    error InvalidTokenContract(address token);
    error FeeOnTransferUnsupported();
    error InvalidTimestamp(uint64 provided, uint64 current);
    error DurationTooLong(uint64 duration);
    error InvalidConditionHash();
    error EscrowNotFound(uint256 escrowId);
    error InvalidMode(Mode actual, Mode expected);
    error EscrowNotLocked(State current);
    error UnauthorizedCaller();
    error RecoveryWindowActive(uint64 recoveryWindowEnd, uint64 current);
    error RecoveryWindowExpired(uint64 recoveryWindowEnd, uint64 current);
    error DeadlineNotReached(uint64 deadline, uint64 current);
    error DeadlineExpired(uint64 deadline, uint64 current);
    error InvalidOutcome(SettlementOutcome outcome);
    error InvalidNonce();
    error NonceAlreadyUsed(address attestor, bytes32 nonce);
    error StaleOrFutureAttestation(uint64 issuedAt, uint64 expiresAt, uint64 current);
    error AttestationExpired(uint64 expiresAt, uint64 current);
    error InvalidProofHash();
    error AttestationAlreadyUsed(bytes32 digest);
    error InvalidAttestorSignature();

    constructor(
        address initialOwner,
        address[] memory initialAllowedTokens
    ) Ownable(initialOwner) EIP712("RevertEscrow", "1") {
        if (initialOwner == address(0)) revert ZeroAddress();
        for (uint256 i = 0; i < initialAllowedTokens.length; i++) {
            _setAllowedToken(initialAllowedTokens[i], true);
        }
    }

    /**
     * @notice Updates whether an ERC-20 token may be used for new escrows.
     * @dev Does not affect already-funded escrows, which remain claimable/refundable.
     */
    function setAllowedToken(address token, bool allowed) external onlyOwner {
        _setAllowedToken(token, allowed);
    }

    /**
     * @notice Returns the full immutable terms and current state of an escrow.
     */
    function getEscrow(uint256 escrowId) external view returns (Escrow memory) {
        Escrow memory escrow = _escrows[escrowId];
        if (escrow.sender == address(0)) revert EscrowNotFound(escrowId);
        return escrow;
    }

    /**
     * @notice Computes the EIP-712 digest that must be signed by `escrow.attestor`.
     * @dev Domain separator automatically binds `block.chainid` and `address(this)`.
     */
    function hashSettlementAttestation(
        SettlementAttestationInput calldata input,
        bytes32 conditionHash
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                SETTLEMENT_ATTESTATION_TYPEHASH,
                input.escrowId,
                conditionHash,
                uint8(input.outcome),
                input.evidenceHash,
                input.signalHash,
                input.receiptHash,
                input.nonce,
                input.issuedAt,
                input.expiresAt
            )
        );
        return _hashTypedDataV4(structHash);
    }

    /**
     * @notice Mode A: Locks ERC-20 tokens with an immutable sender recovery window.
     */
    function createProtectedEscrow(
        address recipient,
        address token,
        uint256 amount,
        uint64 recoveryWindowEnd
    ) external nonReentrant returns (uint256 escrowId) {
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();
        if (!allowedTokens[token]) revert TokenNotAllowed(token);

        uint64 nowTs = SafeCast.toUint64(block.timestamp);
        if (recoveryWindowEnd <= nowTs) revert InvalidTimestamp(recoveryWindowEnd, nowTs);
        if (recoveryWindowEnd - nowTs > MAX_ESCROW_DURATION) {
            revert DurationTooLong(recoveryWindowEnd - nowTs);
        }

        _pullExactTokens(token, msg.sender, amount);

        escrowId = nextEscrowId++;
        _escrows[escrowId] = Escrow({
            mode: Mode.Protected,
            state: State.LOCKED,
            sender: msg.sender,
            recipient: recipient,
            token: token,
            amount: amount,
            createdAt: nowTs,
            recoveryWindowEnd: recoveryWindowEnd,
            deadline: recoveryWindowEnd,
            conditionHash: bytes32(0),
            attestor: address(0)
        });

        emit ProtectedEscrowCreated(
            escrowId,
            msg.sender,
            recipient,
            token,
            amount,
            recoveryWindowEnd
        );
    }

    /**
     * @notice Mode A: Sender cancels and reclaims funds strictly before `recoveryWindowEnd`.
     */
    function cancelProtected(uint256 escrowId) external nonReentrant {
        Escrow storage escrow = _requireEscrow(escrowId, Mode.Protected);
        if (msg.sender != escrow.sender) revert UnauthorizedCaller();

        uint64 nowTs = SafeCast.toUint64(block.timestamp);
        if (nowTs >= escrow.recoveryWindowEnd) {
            revert RecoveryWindowExpired(escrow.recoveryWindowEnd, nowTs);
        }

        escrow.state = State.REFUNDED;
        IERC20(escrow.token).safeTransfer(escrow.sender, escrow.amount);

        emit EscrowRefunded(
            escrowId,
            Mode.Protected,
            escrow.sender,
            escrow.token,
            escrow.amount,
            bytes32(0),
            bytes32(0),
            bytes32(0)
        );
    }

    /**
     * @notice Mode A: Recipient claims funds at or after `recoveryWindowEnd`.
     */
    function claimProtected(uint256 escrowId) external nonReentrant {
        Escrow storage escrow = _requireEscrow(escrowId, Mode.Protected);
        if (msg.sender != escrow.recipient) revert UnauthorizedCaller();

        uint64 nowTs = SafeCast.toUint64(block.timestamp);
        if (nowTs < escrow.recoveryWindowEnd) {
            revert RecoveryWindowActive(escrow.recoveryWindowEnd, nowTs);
        }

        escrow.state = State.RELEASED;
        IERC20(escrow.token).safeTransfer(escrow.recipient, escrow.amount);

        emit EscrowReleased(
            escrowId,
            Mode.Protected,
            escrow.recipient,
            escrow.token,
            escrow.amount,
            bytes32(0),
            bytes32(0),
            bytes32(0)
        );
    }

    /**
     * @notice Mode B: Locks ERC-20 tokens for deterministic conditional settlement.
     */
    function createConditionalEscrow(
        address recipient,
        address token,
        uint256 amount,
        uint64 deadline,
        bytes32 conditionHash,
        address attestor
    ) external nonReentrant returns (uint256 escrowId) {
        if (recipient == address(0) || attestor == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();
        if (!allowedTokens[token]) revert TokenNotAllowed(token);
        if (conditionHash == bytes32(0)) revert InvalidConditionHash();

        uint64 nowTs = SafeCast.toUint64(block.timestamp);
        if (deadline <= nowTs) revert InvalidTimestamp(deadline, nowTs);
        if (deadline - nowTs > MAX_ESCROW_DURATION) {
            revert DurationTooLong(deadline - nowTs);
        }

        _pullExactTokens(token, msg.sender, amount);

        escrowId = nextEscrowId++;
        _escrows[escrowId] = Escrow({
            mode: Mode.Conditional,
            state: State.LOCKED,
            sender: msg.sender,
            recipient: recipient,
            token: token,
            amount: amount,
            createdAt: nowTs,
            recoveryWindowEnd: 0,
            deadline: deadline,
            conditionHash: conditionHash,
            attestor: attestor
        });

        emit ConditionalEscrowCreated(
            escrowId,
            msg.sender,
            recipient,
            token,
            amount,
            deadline,
            conditionHash,
            attestor
        );
    }

    /**
     * @notice Mode B: Settles conditional escrow via EIP-712 attestation signed by
     *         `escrow.attestor`. Supports RELEASE (to immutable recipient) or
     *         REFUND (to immutable sender) strictly on or before `escrow.deadline`.
     */
    function settleConditional(
        SettlementAttestationInput calldata input,
        bytes calldata signature
    ) external nonReentrant {
        Escrow storage escrow = _requireEscrow(input.escrowId, Mode.Conditional);

        uint64 nowTs = SafeCast.toUint64(block.timestamp);
        if (nowTs > escrow.deadline) revert DeadlineExpired(escrow.deadline, nowTs);
        if (nowTs > input.expiresAt) revert AttestationExpired(input.expiresAt, nowTs);
        if (
            input.issuedAt > nowTs ||
            input.expiresAt <= input.issuedAt ||
            input.expiresAt - input.issuedAt > MAX_ATTESTATION_TTL
        ) {
            revert StaleOrFutureAttestation(input.issuedAt, input.expiresAt, nowTs);
        }
        if (
            input.outcome != SettlementOutcome.RELEASE &&
            input.outcome != SettlementOutcome.REFUND
        ) {
            revert InvalidOutcome(input.outcome);
        }
        if (input.nonce == bytes32(0)) revert InvalidNonce();
        if (usedNonces[escrow.attestor][input.nonce]) {
            revert NonceAlreadyUsed(escrow.attestor, input.nonce);
        }
        if (
            input.evidenceHash == bytes32(0) ||
            input.signalHash == bytes32(0) ||
            input.receiptHash == bytes32(0)
        ) {
            revert InvalidProofHash();
        }

        bytes32 digest = hashSettlementAttestation(input, escrow.conditionHash);
        if (usedAttestations[digest]) revert AttestationAlreadyUsed(digest);

        address recovered = ECDSA.recover(digest, signature);
        if (recovered != escrow.attestor) revert InvalidAttestorSignature();

        usedAttestations[digest] = true;
        usedNonces[escrow.attestor][input.nonce] = true;

        if (input.outcome == SettlementOutcome.RELEASE) {
            escrow.state = State.RELEASED;
            IERC20(escrow.token).safeTransfer(escrow.recipient, escrow.amount);
            emit EscrowReleased(
                input.escrowId,
                Mode.Conditional,
                escrow.recipient,
                escrow.token,
                escrow.amount,
                input.evidenceHash,
                input.signalHash,
                input.receiptHash
            );
        } else {
            escrow.state = State.REFUNDED;
            IERC20(escrow.token).safeTransfer(escrow.sender, escrow.amount);
            emit EscrowRefunded(
                input.escrowId,
                Mode.Conditional,
                escrow.sender,
                escrow.token,
                escrow.amount,
                input.evidenceHash,
                input.signalHash,
                input.receiptHash
            );
        }
    }

    /**
     * @notice Mode B: Permissionlessly refunds locked funds to `sender` strictly after `deadline`.
     */
    function refundExpired(uint256 escrowId) external nonReentrant {
        Escrow storage escrow = _requireEscrow(escrowId, Mode.Conditional);

        uint64 nowTs = SafeCast.toUint64(block.timestamp);
        if (nowTs <= escrow.deadline) {
            revert DeadlineNotReached(escrow.deadline, nowTs);
        }

        escrow.state = State.REFUNDED;
        IERC20(escrow.token).safeTransfer(escrow.sender, escrow.amount);

        emit EscrowRefunded(
            escrowId,
            Mode.Conditional,
            escrow.sender,
            escrow.token,
            escrow.amount,
            bytes32(0),
            bytes32(0),
            bytes32(0)
        );
    }

    function _setAllowedToken(address token, bool allowed) private {
        if (token == address(0)) revert ZeroAddress();
        if (allowed && token.code.length == 0) revert InvalidTokenContract(token);
        allowedTokens[token] = allowed;
        emit TokenAllowlistUpdated(token, allowed);
    }

    function _requireEscrow(
        uint256 escrowId,
        Mode expectedMode
    ) private view returns (Escrow storage escrow) {
        escrow = _escrows[escrowId];
        if (escrow.sender == address(0)) revert EscrowNotFound(escrowId);
        if (escrow.mode != expectedMode) revert InvalidMode(escrow.mode, expectedMode);
        if (escrow.state != State.LOCKED) revert EscrowNotLocked(escrow.state);
    }

    function _pullExactTokens(address token, address from, uint256 amount) private {
        uint256 beforeBal = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(from, address(this), amount);
        uint256 afterBal = IERC20(token).balanceOf(address(this));
        if (afterBal - beforeBal != amount) revert FeeOnTransferUnsupported();
    }
}
