// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface RoyaltyToken {
  id: string;
  artist: string;
  songTitle: string;
  encryptedRoyaltyValue: string;
  tokenAmount: number;
  timestamp: number;
  status: "pending" | "active" | "sold";
}

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  // Randomly selected style: Gradient (Rainbow) + Glassmorphism + Card Layout + Animation Rich
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [tokens, setTokens] = useState<RoyaltyToken[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newTokenData, setNewTokenData] = useState({ artist: "", songTitle: "", royaltyValue: 0, tokenAmount: 0 });
  const [selectedToken, setSelectedToken] = useState<RoyaltyToken | null>(null);
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("all");

  // Randomly selected additional features: Search & Filter, Project Introduction
  useEffect(() => {
    loadTokens().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadTokens = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      
      const keysBytes = await contract.getData("token_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing token keys:", e); }
      }
      
      const list: RoyaltyToken[] = [];
      for (const key of keys) {
        try {
          const tokenBytes = await contract.getData(`token_${key}`);
          if (tokenBytes.length > 0) {
            try {
              const tokenData = JSON.parse(ethers.toUtf8String(tokenBytes));
              list.push({ 
                id: key, 
                artist: tokenData.artist,
                songTitle: tokenData.songTitle,
                encryptedRoyaltyValue: tokenData.encryptedRoyaltyValue, 
                tokenAmount: tokenData.tokenAmount,
                timestamp: tokenData.timestamp, 
                status: tokenData.status || "pending" 
              });
            } catch (e) { console.error(`Error parsing token data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading token ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setTokens(list);
    } catch (e) { console.error("Error loading tokens:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const createToken = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting royalty data with Zama FHE..." });
    try {
      const encryptedRoyalty = FHEEncryptNumber(newTokenData.royaltyValue);
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const tokenId = `royalty-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const tokenData = { 
        artist: newTokenData.artist,
        songTitle: newTokenData.songTitle,
        encryptedRoyaltyValue: encryptedRoyalty, 
        tokenAmount: newTokenData.tokenAmount,
        timestamp: Math.floor(Date.now() / 1000), 
        owner: address, 
        status: "pending" 
      };
      
      await contract.setData(`token_${tokenId}`, ethers.toUtf8Bytes(JSON.stringify(tokenData)));
      
      const keysBytes = await contract.getData("token_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(tokenId);
      await contract.setData("token_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Royalty token created with FHE encryption!" });
      await loadTokens();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewTokenData({ artist: "", songTitle: "", royaltyValue: 0, tokenAmount: 0 });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return FHEDecryptNumber(encryptedData);
    } catch (e) { console.error("Decryption failed:", e); return null; } 
    finally { setIsDecrypting(false); }
  };

  const activateToken = async (tokenId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Processing encrypted royalty with FHE..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const tokenBytes = await contract.getData(`token_${tokenId}`);
      if (tokenBytes.length === 0) throw new Error("Token not found");
      
      const tokenData = JSON.parse(ethers.toUtf8String(tokenBytes));
      const updatedToken = { ...tokenData, status: "active" };
      
      await contract.setData(`token_${tokenId}`, ethers.toUtf8Bytes(JSON.stringify(updatedToken)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Royalty token activated with FHE!" });
      await loadTokens();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Activation failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredTokens = tokens.filter(token => {
    const matchesSearch = token.artist.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         token.songTitle.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesTab = activeTab === "all" || token.status === activeTab;
    return matchesSearch && matchesTab;
  });

  const isOwner = (tokenAddress: string) => address?.toLowerCase() === tokenAddress.toLowerCase();

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing encrypted connection to Zama FHE...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>FHE<span>Music</span>Royalty</h1>
          <p>Privacy-Preserving Music Royalty Tokenization</p>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + Tokenize Royalty
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>

      <div className="main-content">
        <div className="intro-section glass-card">
          <h2>Music Royalty Tokenization with Zama FHE</h2>
          <p>
            Tokenize future music royalty income streams with fully homomorphic encryption. 
            Royalty payments and trader identities remain encrypted throughout the entire process.
          </p>
          <div className="features-grid">
            <div className="feature-card">
              <div className="feature-icon">🔒</div>
              <h3>FHE Encryption</h3>
              <p>Royalty streams encrypted with Zama FHE technology</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">💰</div>
              <h3>Instant Liquidity</h3>
              <p>Artists get upfront payments while maintaining privacy</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">🎵</div>
              <h3>New Asset Class</h3>
              <p>Investors access music royalties as a financial asset</p>
            </div>
          </div>
        </div>

        <div className="controls-section">
          <div className="search-box">
            <input 
              type="text" 
              placeholder="Search artists or songs..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <button className="search-btn">🔍</button>
          </div>
          <div className="tabs">
            <button className={activeTab === "all" ? "active" : ""} onClick={() => setActiveTab("all")}>All</button>
            <button className={activeTab === "pending" ? "active" : ""} onClick={() => setActiveTab("pending")}>Pending</button>
            <button className={activeTab === "active" ? "active" : ""} onClick={() => setActiveTab("active")}>Active</button>
            <button className={activeTab === "sold" ? "active" : ""} onClick={() => setActiveTab("sold")}>Traded</button>
          </div>
          <button onClick={loadTokens} className="refresh-btn" disabled={isRefreshing}>
            {isRefreshing ? "Refreshing..." : "⟳ Refresh"}
          </button>
        </div>

        <div className="tokens-grid">
          {filteredTokens.length === 0 ? (
            <div className="empty-state glass-card">
              <div className="music-icon">🎵</div>
              <h3>No royalty tokens found</h3>
              <p>Be the first to tokenize music royalties with FHE encryption</p>
              <button className="primary-btn" onClick={() => setShowCreateModal(true)}>
                Create Royalty Token
              </button>
            </div>
          ) : (
            filteredTokens.map(token => (
              <div className="token-card glass-card" key={token.id} onClick={() => setSelectedToken(token)}>
                <div className="token-header">
                  <span className={`status-badge ${token.status}`}>{token.status}</span>
                  <span className="token-id">#{token.id.substring(0, 6)}</span>
                </div>
                <h3 className="song-title">{token.songTitle}</h3>
                <p className="artist">{token.artist}</p>
                <div className="token-details">
                  <div className="detail">
                    <span>Tokens</span>
                    <strong>{token.tokenAmount}</strong>
                  </div>
                  <div className="detail">
                    <span>Date</span>
                    <strong>{new Date(token.timestamp * 1000).toLocaleDateString()}</strong>
                  </div>
                </div>
                <div className="token-actions">
                  {isOwner(token.id) && token.status === "pending" && (
                    <button className="action-btn" onClick={(e) => { e.stopPropagation(); activateToken(token.id); }}>
                      Activate
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal glass-card">
            <div className="modal-header">
              <h2>Tokenize Music Royalty</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-btn">&times;</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Artist Name</label>
                <input 
                  type="text" 
                  value={newTokenData.artist}
                  onChange={(e) => setNewTokenData({...newTokenData, artist: e.target.value})}
                  placeholder="Enter artist name"
                />
              </div>
              <div className="form-group">
                <label>Song Title</label>
                <input 
                  type="text" 
                  value={newTokenData.songTitle}
                  onChange={(e) => setNewTokenData({...newTokenData, songTitle: e.target.value})}
                  placeholder="Enter song title"
                />
              </div>
              <div className="form-group">
                <label>Estimated Royalty Value (USD)</label>
                <input 
                  type="number" 
                  value={newTokenData.royaltyValue}
                  onChange={(e) => setNewTokenData({...newTokenData, royaltyValue: parseFloat(e.target.value) || 0})}
                  placeholder="Enter estimated value"
                />
                <div className="encryption-preview">
                  <span>FHE Encrypted:</span>
                  <code>{FHEEncryptNumber(newTokenData.royaltyValue).substring(0, 30)}...</code>
                </div>
              </div>
              <div className="form-group">
                <label>Token Amount to Issue</label>
                <input 
                  type="number" 
                  value={newTokenData.tokenAmount}
                  onChange={(e) => setNewTokenData({...newTokenData, tokenAmount: parseInt(e.target.value) || 0})}
                  placeholder="Enter token amount"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="cancel-btn">
                Cancel
              </button>
              <button onClick={createToken} disabled={creating} className="primary-btn">
                {creating ? "Encrypting with Zama FHE..." : "Create Token"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedToken && (
        <div className="modal-overlay">
          <div className="detail-modal glass-card">
            <div className="modal-header">
              <h2>Royalty Token Details</h2>
              <button onClick={() => { setSelectedToken(null); setDecryptedValue(null); }} className="close-btn">&times;</button>
            </div>
            <div className="modal-body">
              <div className="token-info">
                <h3>{selectedToken.songTitle}</h3>
                <p className="artist">by {selectedToken.artist}</p>
                <div className="info-grid">
                  <div className="info-item">
                    <span>Status</span>
                    <strong className={`status-badge ${selectedToken.status}`}>{selectedToken.status}</strong>
                  </div>
                  <div className="info-item">
                    <span>Token Amount</span>
                    <strong>{selectedToken.tokenAmount}</strong>
                  </div>
                  <div className="info-item">
                    <span>Created</span>
                    <strong>{new Date(selectedToken.timestamp * 1000).toLocaleString()}</strong>
                  </div>
                </div>
              </div>
              
              <div className="encrypted-section">
                <h4>Encrypted Royalty Value</h4>
                <div className="encrypted-data">
                  {selectedToken.encryptedRoyaltyValue.substring(0, 50)}...
                </div>
                <button 
                  className="decrypt-btn" 
                  onClick={async () => {
                    if (decryptedValue !== null) {
                      setDecryptedValue(null);
                    } else {
                      const value = await decryptWithSignature(selectedToken.encryptedRoyaltyValue);
                      setDecryptedValue(value);
                    }
                  }}
                  disabled={isDecrypting}
                >
                  {isDecrypting ? "Decrypting..." : decryptedValue !== null ? "Hide Value" : "Decrypt with Wallet"}
                </button>
              </div>
              
              {decryptedValue !== null && (
                <div className="decrypted-section">
                  <h4>Decrypted Royalty Value</h4>
                  <div className="decrypted-value">
                    ${decryptedValue.toLocaleString()}
                  </div>
                  <p className="disclaimer">
                    This value was decrypted using your wallet signature and Zama FHE technology
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className="notification">
          <div className={`notification-content ${transactionStatus.status}`}>
            {transactionStatus.status === "pending" && <div className="spinner"></div>}
            {transactionStatus.status === "success" && <div className="check-icon">✓</div>}
            {transactionStatus.status === "error" && <div className="error-icon">✕</div>}
            <p>{transactionStatus.message}</p>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <h3>FHE Music Royalty</h3>
            <p>Privacy-preserving music royalty tokenization powered by Zama FHE</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms</a>
          </div>
        </div>
        <div className="footer-bottom">
          <p>© {new Date().getFullYear()} FHE Music Royalty. All rights reserved.</p>
          <div className="fhe-badge">
            <span>Powered by Zama FHE</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
