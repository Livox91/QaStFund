// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Successor to EmployeeLendingEscrow that keeps the V1 offer,
/// acceptance, borrow-authorization and loan-getter interface unchanged, and
/// adds partial repayment plus a borrower-granted repayment mandate.
///
/// A mandate lets one named agent address repay the borrower's own loans to
/// the recorded lender, and nothing else. Every limit is enforced here, so a
/// compromised agent key can at most move capped amounts from a borrower to
/// that borrower's lender, never above the per-repayment cap, the rolling
/// period cap, or below the borrower's minimum reserve.
contract EmployeeLendingEscrowV3 is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // The borrow authorization schema is identical to V1. The EIP-712 domain
    // keeps V1's name and version so the existing server signer is reused;
    // verifyingContract still binds every signature to this deployment.
    bytes32 public constant BORROW_AUTHORIZATION_TYPEHASH = keccak256(
        "BorrowAuthorization(uint256 offerId,address borrower,uint256 expiry,bytes32 authorizationId)"
    );

    uint256 public constant MIN_MANDATE_PERIOD = 1 days;
    uint256 public constant MAX_MANDATE_PERIOD = 366 days;

    struct LoanOffer {
        uint256 id;
        address lender;
        uint256 principal;
        uint256 interestBps;
        uint256 duration;
        bool active;
        bytes32 requestId;
    }

    enum LoanStatus {
        ACTIVE,
        REPAID,
        DEFAULTED
    }

    struct Loan {
        uint256 id;
        uint256 offerId;
        address lender;
        address borrower;
        uint256 principal;
        uint256 interestBps;
        uint256 repaymentAmount;
        uint256 startTime;
        uint256 dueTime;
        LoanStatus status;
        uint256 repaidAt;
    }

    struct RepaymentMandate {
        address agent;
        uint256 maxPerRepayment;
        uint256 maxPerPeriod;
        uint256 minimumReserve;
        uint256 periodSeconds;
        uint256 earliestBeforeDueSeconds;
        uint256 expiresAt;
        uint256 periodStart;
        uint256 spentInPeriod;
        uint256 nonce;
        bool active;
    }

    IERC20 public immutable usdc;
    address public immutable authorizationSigner;
    uint256 public nextOfferId = 1;
    uint256 public nextLoanId = 1;
    uint256 public totalReserved;

    mapping(uint256 offerId => LoanOffer offer) public offers;
    mapping(uint256 loanId => Loan loan) public loans;
    mapping(uint256 loanId => uint256 amount) public repaidAmounts;
    mapping(uint256 offerId => uint256 loanId) public offerLoanIds;
    mapping(bytes32 requestId => bool used) public usedRequestIds;
    mapping(bytes32 authorizationId => bool used) public usedBorrowAuthorizations;
    mapping(bytes32 repaymentId => bool used) public usedRepaymentIds;
    mapping(address borrower => RepaymentMandate mandate) public repaymentMandates;

    error AuthorizationAlreadyUsed();
    error AuthorizationExpired();
    error DuplicateRepayment();
    error DuplicateRequest();
    error InvalidAuthorization();
    error InvalidAuthorizationId();
    error InvalidDuration();
    error InvalidInterestRate();
    error InvalidLoan();
    error InvalidMandate();
    error InvalidPrincipal();
    error InvalidRepayment();
    error InvalidRequestId();
    error LoanNotActive();
    error MandateChanged();
    error MandateExpired();
    error MandateNotActive();
    error NotLoanBorrower();
    error NotMandateAgent();
    error NotOfferLender();
    error OfferNotActive();
    error PeriodCapExceeded();
    error RepaymentCapExceeded();
    error RepaymentExceedsOutstanding();
    error RepaymentWindowNotOpen();
    error ReserveViolation();
    error SelfBorrowingNotAllowed();
    error UnsupportedTokenTransfer();
    error ZeroAddress();

    event OfferCreated(
        uint256 indexed offerId,
        address indexed lender,
        uint256 principal,
        uint256 interestBps,
        uint256 duration,
        bytes32 indexed requestId
    );

    event OfferCancelled(
        uint256 indexed offerId,
        address indexed lender,
        uint256 principal
    );

    event LoanStarted(
        uint256 indexed loanId,
        uint256 indexed offerId,
        address indexed lender,
        address borrower,
        uint256 principal,
        uint256 repaymentAmount,
        uint256 startTime,
        uint256 dueTime
    );

    event LoanRepaymentReceived(
        uint256 indexed loanId,
        bytes32 indexed repaymentId,
        address indexed borrower,
        address lender,
        address payer,
        uint256 amount,
        uint256 totalRepaid,
        uint256 remaining
    );

    /// @dev Same signature and meaning as V1: `amount` is the full repayment
    /// obligation, emitted once when the loan becomes fully repaid.
    event LoanRepaid(
        uint256 indexed loanId,
        address indexed borrower,
        address indexed lender,
        uint256 amount,
        uint256 repaidAt
    );

    event RepaymentMandateSet(
        address indexed borrower,
        address indexed agent,
        uint256 indexed nonce,
        uint256 maxPerRepayment,
        uint256 maxPerPeriod,
        uint256 minimumReserve,
        uint256 periodSeconds,
        uint256 earliestBeforeDueSeconds,
        uint256 expiresAt
    );

    event RepaymentMandateRevoked(address indexed borrower, uint256 indexed nonce);

    event AgentRepaymentExecuted(
        uint256 indexed loanId,
        bytes32 indexed repaymentId,
        address indexed agent,
        address borrower,
        uint256 amount,
        uint256 mandateNonce,
        uint256 spentInPeriod
    );

    constructor(IERC20 usdcAddress, address borrowAuthorizationSigner)
        EIP712("EmployeeLendingEscrow", "1")
    {
        if (
            address(usdcAddress) == address(0) ||
            borrowAuthorizationSigner == address(0)
        ) revert ZeroAddress();
        usdc = usdcAddress;
        authorizationSigner = borrowAuthorizationSigner;
    }

    function createOffer(
        uint256 principal,
        uint256 interestBps,
        uint256 duration,
        bytes32 requestId
    ) external nonReentrant returns (uint256 offerId) {
        if (principal == 0) revert InvalidPrincipal();
        if (duration == 0) revert InvalidDuration();
        if (interestBps > 10_000) revert InvalidInterestRate();
        if (requestId == bytes32(0)) revert InvalidRequestId();
        if (usedRequestIds[requestId]) revert DuplicateRequest();

        uint256 balanceBefore = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), principal);
        if (usdc.balanceOf(address(this)) - balanceBefore != principal) {
            revert UnsupportedTokenTransfer();
        }

        offerId = nextOfferId++;
        usedRequestIds[requestId] = true;
        totalReserved += principal;
        offers[offerId] = LoanOffer({
            id: offerId,
            lender: msg.sender,
            principal: principal,
            interestBps: interestBps,
            duration: duration,
            active: true,
            requestId: requestId
        });

        emit OfferCreated(offerId, msg.sender, principal, interestBps, duration, requestId);
    }

    function cancelOffer(uint256 offerId) external nonReentrant {
        LoanOffer storage offer = offers[offerId];
        if (!offer.active) revert OfferNotActive();
        if (offer.lender != msg.sender) revert NotOfferLender();

        offer.active = false;
        totalReserved -= offer.principal;
        usdc.safeTransfer(offer.lender, offer.principal);

        emit OfferCancelled(offerId, offer.lender, offer.principal);
    }

    function acceptOffer(
        uint256 offerId,
        uint256 authorizationExpiry,
        bytes32 authorizationId,
        bytes calldata authorizationSignature
    ) external nonReentrant returns (uint256 loanId) {
        if (authorizationId == bytes32(0)) revert InvalidAuthorizationId();
        if (usedBorrowAuthorizations[authorizationId]) revert AuthorizationAlreadyUsed();
        if (block.timestamp > authorizationExpiry) revert AuthorizationExpired();

        LoanOffer storage offer = offers[offerId];
        if (!offer.active) revert OfferNotActive();
        if (offer.lender == msg.sender) revert SelfBorrowingNotAllowed();

        bytes32 authorizationDigest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    BORROW_AUTHORIZATION_TYPEHASH,
                    offerId,
                    msg.sender,
                    authorizationExpiry,
                    authorizationId
                )
            )
        );
        if (
            !SignatureChecker.isValidSignatureNow(
                authorizationSigner,
                authorizationDigest,
                authorizationSignature
            )
        ) revert InvalidAuthorization();

        // Round interest up to the nearest USDC base unit so a positive
        // fractional-base-unit obligation is never rounded away.
        uint256 interest = (offer.principal * offer.interestBps + 9_999) / 10_000;
        uint256 repaymentAmount = offer.principal + interest;
        uint256 startTime = block.timestamp;
        uint256 dueTime = startTime + offer.duration;

        offer.active = false;
        usedBorrowAuthorizations[authorizationId] = true;
        totalReserved -= offer.principal;
        loanId = nextLoanId++;
        offerLoanIds[offerId] = loanId;
        loans[loanId] = Loan({
            id: loanId,
            offerId: offerId,
            lender: offer.lender,
            borrower: msg.sender,
            principal: offer.principal,
            interestBps: offer.interestBps,
            repaymentAmount: repaymentAmount,
            startTime: startTime,
            dueTime: dueTime,
            status: LoanStatus.ACTIVE,
            repaidAt: 0
        });

        usdc.safeTransfer(msg.sender, offer.principal);

        emit LoanStarted(
            loanId,
            offerId,
            offer.lender,
            msg.sender,
            offer.principal,
            repaymentAmount,
            startTime,
            dueTime
        );
    }

    /// @notice Repays the full remaining balance. Kept for V1 compatibility.
    function repayLoan(uint256 loanId) external nonReentrant {
        Loan storage loan = _activeLoan(loanId);
        if (loan.borrower != msg.sender) revert NotLoanBorrower();
        uint256 remaining = loan.repaymentAmount - repaidAmounts[loanId];
        _applyRepayment(loanId, loan, msg.sender, remaining, bytes32(0));
    }

    /// @notice Borrower-signed repayment of any amount up to the outstanding balance.
    function repayLoanPartial(uint256 loanId, uint256 amount, bytes32 repaymentId)
        external
        nonReentrant
    {
        Loan storage loan = _activeLoan(loanId);
        if (loan.borrower != msg.sender) revert NotLoanBorrower();
        if (repaymentId == bytes32(0)) revert InvalidRepayment();
        _applyRepayment(loanId, loan, msg.sender, amount, repaymentId);
    }

    function setRepaymentMandate(
        address agent,
        uint256 maxPerRepayment,
        uint256 maxPerPeriod,
        uint256 minimumReserve,
        uint256 periodSeconds,
        uint256 earliestBeforeDueSeconds,
        uint256 expiresAt
    ) external returns (uint256 nonce) {
        if (agent == address(0)) revert ZeroAddress();
        if (
            agent == msg.sender ||
            maxPerRepayment == 0 ||
            maxPerPeriod < maxPerRepayment ||
            periodSeconds < MIN_MANDATE_PERIOD ||
            periodSeconds > MAX_MANDATE_PERIOD ||
            expiresAt <= block.timestamp
        ) revert InvalidMandate();

        RepaymentMandate storage mandate = repaymentMandates[msg.sender];
        nonce = mandate.nonce + 1;
        repaymentMandates[msg.sender] = RepaymentMandate({
            agent: agent,
            maxPerRepayment: maxPerRepayment,
            maxPerPeriod: maxPerPeriod,
            minimumReserve: minimumReserve,
            periodSeconds: periodSeconds,
            earliestBeforeDueSeconds: earliestBeforeDueSeconds,
            expiresAt: expiresAt,
            periodStart: block.timestamp,
            spentInPeriod: 0,
            nonce: nonce,
            active: true
        });

        emit RepaymentMandateSet(
            msg.sender,
            agent,
            nonce,
            maxPerRepayment,
            maxPerPeriod,
            minimumReserve,
            periodSeconds,
            earliestBeforeDueSeconds,
            expiresAt
        );
    }

    function revokeRepaymentMandate() external {
        RepaymentMandate storage mandate = repaymentMandates[msg.sender];
        if (!mandate.active) revert MandateNotActive();
        mandate.active = false;
        emit RepaymentMandateRevoked(msg.sender, mandate.nonce);
    }

    /// @notice Agent-initiated repayment, bounded by the borrower's mandate.
    /// @param mandateNonce The mandate version the agent planned against. Any
    /// borrower change to the mandate invalidates in-flight agent plans.
    function repayOnBehalf(
        uint256 loanId,
        uint256 amount,
        bytes32 repaymentId,
        uint256 mandateNonce
    ) external nonReentrant {
        Loan storage loan = _activeLoan(loanId);
        RepaymentMandate storage mandate = repaymentMandates[loan.borrower];
        if (!mandate.active) revert MandateNotActive();
        if (mandate.agent != msg.sender) revert NotMandateAgent();
        if (mandate.nonce != mandateNonce) revert MandateChanged();
        if (block.timestamp > mandate.expiresAt) revert MandateExpired();
        if (repaymentId == bytes32(0) || amount == 0) revert InvalidRepayment();
        if (amount > mandate.maxPerRepayment) revert RepaymentCapExceeded();
        if (block.timestamp + mandate.earliestBeforeDueSeconds < loan.dueTime) {
            revert RepaymentWindowNotOpen();
        }

        if (block.timestamp >= mandate.periodStart + mandate.periodSeconds) {
            mandate.periodStart = block.timestamp;
            mandate.spentInPeriod = 0;
        }
        if (mandate.spentInPeriod + amount > mandate.maxPerPeriod) revert PeriodCapExceeded();
        if (usdc.balanceOf(loan.borrower) < amount + mandate.minimumReserve) {
            revert ReserveViolation();
        }

        mandate.spentInPeriod += amount;
        _applyRepayment(loanId, loan, loan.borrower, amount, repaymentId);

        emit AgentRepaymentExecuted(
            loanId,
            repaymentId,
            msg.sender,
            loan.borrower,
            amount,
            mandateNonce,
            mandate.spentInPeriod
        );
    }

    function _activeLoan(uint256 loanId) private view returns (Loan storage loan) {
        loan = loans[loanId];
        if (loan.id == 0) revert InvalidLoan();
        if (loan.status != LoanStatus.ACTIVE) revert LoanNotActive();
    }

    function _applyRepayment(
        uint256 loanId,
        Loan storage loan,
        address payer,
        uint256 amount,
        bytes32 repaymentId
    ) private {
        if (amount == 0) revert InvalidRepayment();
        if (repaymentId != bytes32(0)) {
            if (usedRepaymentIds[repaymentId]) revert DuplicateRepayment();
            usedRepaymentIds[repaymentId] = true;
        }
        uint256 outstanding = loan.repaymentAmount - repaidAmounts[loanId];
        if (amount > outstanding) revert RepaymentExceedsOutstanding();

        uint256 totalRepaid = repaidAmounts[loanId] + amount;
        repaidAmounts[loanId] = totalRepaid;
        uint256 remaining = loan.repaymentAmount - totalRepaid;
        if (remaining == 0) {
            loan.status = LoanStatus.REPAID;
            loan.repaidAt = block.timestamp;
        }

        usdc.safeTransferFrom(payer, loan.lender, amount);

        emit LoanRepaymentReceived(
            loanId,
            repaymentId,
            loan.borrower,
            loan.lender,
            payer,
            amount,
            totalRepaid,
            remaining
        );
        if (remaining == 0) {
            emit LoanRepaid(loanId, loan.borrower, loan.lender, loan.repaymentAmount, loan.repaidAt);
        }
    }
}
