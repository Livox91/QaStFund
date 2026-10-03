// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract EmployeeLendingEscrow is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant BORROW_AUTHORIZATION_TYPEHASH = keccak256(
        "BorrowAuthorization(uint256 offerId,address borrower,uint256 expiry,bytes32 authorizationId)"
    );

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

    IERC20 public immutable usdc;
    address public immutable authorizationSigner;
    uint256 public nextOfferId = 1;
    uint256 public nextLoanId = 1;
    uint256 public totalReserved;

    mapping(uint256 offerId => LoanOffer offer) public offers;
    mapping(uint256 loanId => Loan loan) public loans;
    mapping(uint256 offerId => uint256 loanId) public offerLoanIds;
    mapping(bytes32 requestId => bool used) public usedRequestIds;
    mapping(bytes32 authorizationId => bool used) public usedBorrowAuthorizations;

    error AuthorizationAlreadyUsed();
    error AuthorizationExpired();
    error DuplicateRequest();
    error InvalidAuthorization();
    error InvalidAuthorizationId();
    error InvalidDuration();
    error InvalidInterestRate();
    error InvalidLoan();
    error InvalidPrincipal();
    error InvalidRequestId();
    error NotOfferLender();
    error NotLoanBorrower();
    error LoanNotActive();
    error OfferNotActive();
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

    event LoanRepaid(
        uint256 indexed loanId,
        address indexed borrower,
        address indexed lender,
        uint256 amount,
        uint256 repaidAt
    );

    constructor(IERC20 usdcAddress, address borrowAuthorizationSigner) EIP712("EmployeeLendingEscrow", "1") {
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

        emit OfferCreated(
            offerId,
            msg.sender,
            principal,
            interestBps,
            duration,
            requestId
        );
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
        if (usedBorrowAuthorizations[authorizationId]) {
            revert AuthorizationAlreadyUsed();
        }
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
        uint256 interest = (offer.principal * offer.interestBps + 9_999) /
            10_000;
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

    function repayLoan(uint256 loanId) external nonReentrant {
        Loan storage loan = loans[loanId];
        if (loan.id == 0) revert InvalidLoan();
        if (loan.status != LoanStatus.ACTIVE) revert LoanNotActive();
        if (loan.borrower != msg.sender) revert NotLoanBorrower();

        uint256 repaidAt = block.timestamp;
        loan.status = LoanStatus.REPAID;
        loan.repaidAt = repaidAt;
        usdc.safeTransferFrom(msg.sender, loan.lender, loan.repaymentAmount);

        emit LoanRepaid(
            loanId,
            msg.sender,
            loan.lender,
            loan.repaymentAmount,
            repaidAt
        );
    }
}
