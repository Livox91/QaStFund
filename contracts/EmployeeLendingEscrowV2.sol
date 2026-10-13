// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Local-tested successor to EmployeeLendingEscrow. It is intentionally
/// separate because the currently deployed Arc contract has immutable V1 terms.
contract EmployeeLendingEscrowV2 is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant BORROW_AUTHORIZATION_TYPEHASH = keccak256(
        "BorrowAuthorization(uint256 offerId,address borrower,uint256 principal,uint256 duration,uint256 expiry,bytes32 authorizationId)"
    );

    struct LoanOffer {
        uint256 id;
        address lender;
        uint256 originalPrincipal;
        uint256 availablePrincipal;
        uint256 interestBps;
        uint256 maximumDuration;
        bool active;
        bytes32 requestId;
    }

    enum LoanStatus { ACTIVE, REPAID, DEFAULTED }

    struct Loan {
        uint256 id;
        uint256 offerId;
        address lender;
        address borrower;
        uint256 principal;
        uint256 interestBps;
        uint256 repaymentAmount;
        uint256 repaidAmount;
        uint256 startTime;
        uint256 dueTime;
        LoanStatus status;
        uint256 repaidAt;
    }

    IERC20 public immutable usdc;
    address public immutable authorizationSigner;
    uint256 public nextOfferId = 1;
    uint256 public nextLoanId = 1;
    uint256 public totalReserved;

    mapping(uint256 => LoanOffer) public offers;
    mapping(uint256 => Loan) public loans;
    mapping(uint256 => uint256[]) private _offerLoanIds;
    mapping(bytes32 => bool) public usedRequestIds;
    mapping(bytes32 => bool) public usedBorrowAuthorizations;
    mapping(bytes32 => bool) public usedRepaymentIds;

    error AuthorizationAlreadyUsed();
    error AuthorizationExpired();
    error DuplicateRepayment();
    error DuplicateRequest();
    error InvalidAuthorization();
    error InvalidAuthorizationId();
    error InvalidDuration();
    error InvalidInterestRate();
    error InvalidLoan();
    error InvalidPrincipal();
    error InvalidRepayment();
    error InvalidRequestId();
    error LoanNotActive();
    error NotLoanBorrower();
    error NotOfferLender();
    error OfferNotActive();
    error RepaymentExceedsOutstanding();
    error SelfBorrowingNotAllowed();
    error UnsupportedTokenTransfer();
    error ZeroAddress();

    event OfferCreated(uint256 indexed offerId, address indexed lender, uint256 principal, uint256 interestBps, uint256 maximumDuration, bytes32 indexed requestId);
    event OfferCancelled(uint256 indexed offerId, address indexed lender, uint256 returnedPrincipal);
    event LoanStarted(uint256 indexed loanId, uint256 indexed offerId, address indexed lender, address borrower, uint256 principal, uint256 repaymentAmount, uint256 startTime, uint256 dueTime);
    event LoanRepaymentReceived(uint256 indexed loanId, bytes32 indexed repaymentId, address indexed borrower, address lender, uint256 amount, uint256 totalRepaid, uint256 remaining);
    event LoanRepaid(uint256 indexed loanId, address indexed borrower, address indexed lender, uint256 amount, uint256 repaidAt);

    constructor(IERC20 usdcAddress, address borrowAuthorizationSigner) EIP712("EmployeeLendingEscrowV2", "2") {
        if (address(usdcAddress) == address(0) || borrowAuthorizationSigner == address(0)) revert ZeroAddress();
        usdc = usdcAddress;
        authorizationSigner = borrowAuthorizationSigner;
    }

    function offerLoanCount(uint256 offerId) external view returns (uint256) {
        return _offerLoanIds[offerId].length;
    }

    function offerLoanIdAt(uint256 offerId, uint256 index) external view returns (uint256) {
        return _offerLoanIds[offerId][index];
    }

    function createOffer(uint256 principal, uint256 interestBps, uint256 maximumDuration, bytes32 requestId) external nonReentrant returns (uint256 offerId) {
        if (principal == 0) revert InvalidPrincipal();
        if (maximumDuration == 0) revert InvalidDuration();
        if (interestBps > 10_000) revert InvalidInterestRate();
        if (requestId == bytes32(0)) revert InvalidRequestId();
        if (usedRequestIds[requestId]) revert DuplicateRequest();

        uint256 balanceBefore = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), principal);
        if (usdc.balanceOf(address(this)) - balanceBefore != principal) revert UnsupportedTokenTransfer();

        offerId = nextOfferId++;
        usedRequestIds[requestId] = true;
        totalReserved += principal;
        offers[offerId] = LoanOffer(offerId, msg.sender, principal, principal, interestBps, maximumDuration, true, requestId);
        emit OfferCreated(offerId, msg.sender, principal, interestBps, maximumDuration, requestId);
    }

    function cancelOffer(uint256 offerId) external nonReentrant {
        LoanOffer storage offer = offers[offerId];
        if (!offer.active) revert OfferNotActive();
        if (offer.lender != msg.sender) revert NotOfferLender();
        uint256 returnedPrincipal = offer.availablePrincipal;
        offer.availablePrincipal = 0;
        offer.active = false;
        totalReserved -= returnedPrincipal;
        usdc.safeTransfer(offer.lender, returnedPrincipal);
        emit OfferCancelled(offerId, offer.lender, returnedPrincipal);
    }

    function acceptOffer(
        uint256 offerId,
        uint256 principal,
        uint256 duration,
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
        if (principal == 0 || principal > offer.availablePrincipal) revert InvalidPrincipal();
        if (duration == 0 || duration > offer.maximumDuration) revert InvalidDuration();

        _validateBorrowAuthorization(offerId, principal, duration, authorizationExpiry, authorizationId, authorizationSignature);
        loanId = _startLoan(offerId, principal, duration);
        usedBorrowAuthorizations[authorizationId] = true;
    }

    function _validateBorrowAuthorization(
        uint256 offerId,
        uint256 principal,
        uint256 duration,
        uint256 authorizationExpiry,
        bytes32 authorizationId,
        bytes calldata authorizationSignature
    ) private view {
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(
            BORROW_AUTHORIZATION_TYPEHASH,
            offerId,
            msg.sender,
            principal,
            duration,
            authorizationExpiry,
            authorizationId
        )));
        if (!SignatureChecker.isValidSignatureNow(authorizationSigner, digest, authorizationSignature)) revert InvalidAuthorization();
    }

    function _startLoan(uint256 offerId, uint256 principal, uint256 duration) private returns (uint256 loanId) {
        LoanOffer storage offer = offers[offerId];
        uint256 repaymentAmount = principal + (principal * offer.interestBps + 9_999) / 10_000;
        offer.availablePrincipal -= principal;
        if (offer.availablePrincipal == 0) offer.active = false;
        totalReserved -= principal;
        loanId = nextLoanId++;
        _offerLoanIds[offerId].push(loanId);
        loans[loanId] = Loan(loanId, offerId, offer.lender, msg.sender, principal, offer.interestBps, repaymentAmount, 0, block.timestamp, block.timestamp + duration, LoanStatus.ACTIVE, 0);
        usdc.safeTransfer(msg.sender, principal);
        Loan storage loan = loans[loanId];
        emit LoanStarted(loanId, offerId, offer.lender, msg.sender, principal, repaymentAmount, loan.startTime, loan.dueTime);
    }

    function repayLoan(uint256 loanId, uint256 amount, bytes32 repaymentId) external nonReentrant {
        Loan storage loan = loans[loanId];
        if (loan.id == 0) revert InvalidLoan();
        if (loan.status != LoanStatus.ACTIVE) revert LoanNotActive();
        if (loan.borrower != msg.sender) revert NotLoanBorrower();
        if (repaymentId == bytes32(0) || amount == 0) revert InvalidRepayment();
        if (usedRepaymentIds[repaymentId]) revert DuplicateRepayment();
        uint256 outstanding = loan.repaymentAmount - loan.repaidAmount;
        if (amount > outstanding) revert RepaymentExceedsOutstanding();

        usdc.safeTransferFrom(msg.sender, loan.lender, amount);
        usedRepaymentIds[repaymentId] = true;
        loan.repaidAmount += amount;
        uint256 remaining = loan.repaymentAmount - loan.repaidAmount;
        emit LoanRepaymentReceived(loanId, repaymentId, msg.sender, loan.lender, amount, loan.repaidAmount, remaining);
        if (remaining == 0) {
            loan.status = LoanStatus.REPAID;
            loan.repaidAt = block.timestamp;
            emit LoanRepaid(loanId, msg.sender, loan.lender, loan.repaymentAmount, loan.repaidAt);
        }
    }
}
