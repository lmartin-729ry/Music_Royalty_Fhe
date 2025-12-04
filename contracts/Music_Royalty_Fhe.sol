pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract MusicRoyaltyFhe is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    address public owner;
    mapping(address => bool) public providers;
    bool public paused;
    uint256 public cooldownSeconds;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    uint256 public currentBatchId;
    mapping(uint256 => bool) public batchClosed;
    mapping(uint256 => uint256) public totalEncryptedRoyaltiesInBatch;
    mapping(uint256 => mapping(address => euint32)) public encryptedRoyalties;
    mapping(uint256 => mapping(address => ebool)) public hasSubmittedToBatch;

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    event CooldownSecondsSet(uint256 oldCooldownSeconds, uint256 newCooldownSeconds);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event RoyaltySubmitted(address indexed provider, uint256 indexed batchId, euint32 encryptedAmount);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint256 totalRoyalties);

    error NotOwner();
    error NotProvider();
    error PausedError();
    error CooldownActive();
    error BatchClosedError();
    error AlreadySubmitted();
    error ReplayError();
    error StateMismatchError();
    error InvalidBatchError();
    error NotInitialized();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!providers[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert PausedError();
        _;
    }

    modifier respectCooldown(address user, mapping(address => uint256) storage accessTime, string memory errorMessage) {
        if (block.timestamp < accessTime[user] + cooldownSeconds) revert CooldownActive();
        accessTime[user] = block.timestamp;
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function addProvider(address provider) external onlyOwner {
        providers[provider] = true;
        emit ProviderAdded(provider);
    }

    function removeProvider(address provider) external onlyOwner {
        providers[provider] = false;
        emit ProviderRemoved(provider);
    }

    function setPaused(bool _paused) external onlyOwner {
        if (_paused) {
            paused = true;
            emit Paused(msg.sender);
        } else {
            paused = false;
            emit Unpaused(msg.sender);
        }
    }

    function setCooldownSeconds(uint256 _cooldownSeconds) external onlyOwner {
        uint256 oldCooldownSeconds = cooldownSeconds;
        cooldownSeconds = _cooldownSeconds;
        emit CooldownSecondsSet(oldCooldownSeconds, _cooldownSeconds);
    }

    function openBatch() external onlyOwner whenNotPaused {
        currentBatchId++;
        batchClosed[currentBatchId] = false;
        totalEncryptedRoyaltiesInBatch[currentBatchId] = 0;
        emit BatchOpened(currentBatchId);
    }

    function closeBatch(uint256 batchId) external onlyOwner {
        if (batchClosed[batchId]) revert BatchClosedError();
        batchClosed[batchId] = true;
        emit BatchClosed(batchId);
    }

    function submitEncryptedRoyalty(uint256 batchId, euint32 encryptedAmount)
        external
        onlyProvider
        whenNotPaused
        respectCooldown(msg.sender, lastSubmissionTime, "Submission cooldown active")
    {
        if (batchClosed[batchId]) revert BatchClosedError();
        if (hasSubmittedToBatch[batchId][msg.sender]) revert AlreadySubmitted();

        _initIfNeeded(encryptedAmount);

        encryptedRoyalties[batchId][msg.sender] = encryptedAmount;
        hasSubmittedToBatch[batchId][msg.sender] = ebool(true);
        totalEncryptedRoyaltiesInBatch[batchId] = totalEncryptedRoyaltiesInBatch[batchId].add(encryptedAmount);

        emit RoyaltySubmitted(msg.sender, batchId, encryptedAmount);
    }

    function requestTotalRoyaltyDecryption(uint256 batchId)
        external
        onlyOwner
        whenNotPaused
        respectCooldown(msg.sender, lastDecryptionRequestTime, "Decryption request cooldown active")
    {
        if (!batchClosed[batchId]) revert InvalidBatchError();
        if (totalEncryptedRoyaltiesInBatch[batchId].isInitialized() == FHE.ebool(false)) revert NotInitialized();

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = totalEncryptedRoyaltiesInBatch[batchId].toBytes32();

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({ batchId: batchId, stateHash: stateHash, processed: false });
        emit DecryptionRequested(requestId, batchId);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        if (decryptionContexts[requestId].processed) revert ReplayError();

        uint256 batchId = decryptionContexts[requestId].batchId;
        bytes32[] memory currentCts = new bytes32[](1);
        currentCts[0] = totalEncryptedRoyaltiesInBatch[batchId].toBytes32();

        bytes32 currentStateHash = _hashCiphertexts(currentCts);
        if (currentStateHash != decryptionContexts[requestId].stateHash) {
            revert StateMismatchError();
        }

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint256 totalRoyalties = abi.decode(cleartexts, (uint256));
        decryptionContexts[requestId].processed = true;
        emit DecryptionCompleted(requestId, batchId, totalRoyalties);
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded(euint32 val) internal {
        if (val.isInitialized() == FHE.ebool(false)) revert NotInitialized();
    }

    function _requireInitialized(euint32 val) internal view {
        if (val.isInitialized() == FHE.ebool(false)) revert NotInitialized();
    }
}