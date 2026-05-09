const express = require('express');
const fs = require('fs');
const os = require('os');
const cors = require('cors');
const WebSocket = require('ws'); 
const { Blockchain, Transaction } = require('./nodecoin');

// --- ANSI COLORS ---
const color = {
    green: "\x1b[32m", cyan: "\x1b[36m", yellow: "\x1b[33m",
    blue: "\x1b[34m", magenta: "\x1b[35m", red: "\x1b[31m",
    white: "\x1b[37m", reset: "\x1b[0m", gray: "\x1b[90m"
};

// --- CONFIGURATION ---
const HTTP_PORT = process.env.HTTP_PORT || 3000;
const P2P_PORT = process.env.P2P_PORT || 5001;
const initialPeers = ['ws://102.209.76.210:5001'];
const GLOBAL_POOL_URL = 'http://102.209.76.210:3000/pool/submit';

const HustlerCoin = new Blockchain();
HustlerCoin.loadChain(); 

let sockets = [];

// --- HTTP SERVER SETUP ---
const app = express();

// 1. FIXED: Enable CORS for ALL origins so your HTML files can talk to the API
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));

app.use(express.json());

// --- ROUTES ---

app.get('/chain', (req, res) => res.json(HustlerCoin.chain));

// 2. FIXED: Route standardized to /balance/:address to match wallet fetch
app.get('/balance/:address', (req, res) => {
    const balance = HustlerCoin.getBalanceOfAddress(req.params.address);
    res.json({ balance: balance.toString() });
});
app.get('/peers', (req, res) => {
    // This lists every unique machine currently connected to your node
    const connectedPeers = sockets.map(s => s._socket.remoteAddress);
    res.json({
        count: connectedPeers.length,
        ips: connectedPeers
    });
});

// Legacy support for /api/balance/
app.get('/api/balance/:address', (req, res) => {
    const balance = HustlerCoin.getBalanceOfAddress(req.params.address);
    res.json({ balance: balance.toString() });
});

app.get('/mining-info', (req, res) => {
    res.json({
        lastHash: HustlerCoin.getLatestBlock().hash,
        difficulty: HustlerCoin.difficulty
    });
});

// 3. FIXED: TRANSACTION ROUTE WITH PRECISE DEBUGGING
app.post('/transaction', (req, res) => {
    const { fromAddress, toAddress, amount, signature, timestamp } = req.body;
    
    try {
        const tx = new Transaction(fromAddress, toAddress, amount, timestamp);
        tx.signature = signature;

        // DEBUG LOGGING (Matches Wallet Raw String)
        console.log(`${color.yellow}--- NODE DEBUG START ---${color.reset}`);
        console.log("FROM:", fromAddress);
        console.log("TO:", toAddress);
        console.log("AMT:", amount);
        console.log("TIME:", timestamp);
        // Explicitly stringifying for log clarity
        console.log("RAW_STRING:", String(fromAddress) + String(toAddress) + String(amount) + String(timestamp));
        console.log("NODE_HASH:", tx.calculateHash());
        console.log("SIGNATURE_RECEIVED:", signature);
        console.log(`${color.yellow}--- NODE DEBUG END ---${color.reset}`);

        HustlerCoin.addTransaction(tx);
        broadcast({ type: 'TRANSACTION', data: tx });

        res.status(200).send("✅ Transaction verified and added to pool!");
    } catch (e) {
        console.log(`${color.red}[ERR] Tx Failed: ${e.message}${color.reset}`);
        res.status(400).send(`Invalid Transaction: ${e.message}`);
    }
});

app.post('/mine', (req, res) => {
    const { minerAddress } = req.body;
    const timestamp = new Date().toLocaleTimeString();

    // 1. Calculate the Monero-style PPLNS split
    const payouts = calculatePPLNSPayouts();

    // 2. If the pool has shares, we pass them to the mining function
    // If not, it defaults to the solo miner
    const rewardData = payouts.length > 0 ? payouts : [{ address: minerAddress, amount: 3.0 }];

    // 3. Trigger the mine (Pass rewardData to your Blockchain class)
    HustlerCoin.minePendingTransactions(minerAddress, rewardData);
    HustlerCoin.saveChain();

    broadcast({ type: 'BLOCK', data: HustlerCoin.getLatestBlock() });

    const newBalance = HustlerCoin.getBalanceOfAddress(minerAddress);
    console.log(`${color.green}[${timestamp}]${color.reset} ${color.magenta} P2POOL ${color.reset} ${color.green}BLOCK MINED & SPLIT${color.reset}`);
    
    // Log the breakdown so you can see it in your terminal
    if (payouts.length > 0) {
        console.log(`${color.white} > Distributed rewards to ${payouts.length} miners.${color.reset}`);
    } else {
        console.log(`${color.white} > Solo reward of 3.0 HUSTL sent to ${minerAddress}${color.reset}`);
    }
    
    res.status(200).send("Block Accepted and Rewards Distributed!");
});

app.post('/pool/submit', (req, res) => {
    const { minerAddress, hash, nonce, blockData } = req.body;
    
    // This calls the sidechain function we added earlier
    handleShareSubmission(minerAddress, hash, blockData); 
    
    res.status(200).send("Share received by Sidechain");
});

// Listen on all interfaces (0.0.0.0)
app.listen(HTTP_PORT, '0.0.0.0', () => {
    printStats(HTTP_PORT, P2P_PORT);
});

// --- P2P ENGINE ---
const p2pServer = new WebSocket.Server({ port: P2P_PORT });
p2pServer.on('connection', ws => initConnection(ws));

function initConnection(ws) {
    sockets.push(ws);
    
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            switch (message.type) {
                case 'BLOCK':
                    handleNewBlock(message.data);
                    break;
                case 'TRANSACTION':
                    handleNewTransaction(message.data);
                    break;
                case 'QUERY_CHAIN':
                    ws.send(JSON.stringify({ type: 'CHAIN', data: HustlerCoin.chain }));
                    break;
                case 'CHAIN':
                    if (message.data.length > HustlerCoin.chain.length) {
                        HustlerCoin.chain = message.data;
                        HustlerCoin.saveChain();
                        console.log(`${color.magenta}[P2P] Chain Synchronized.${color.reset}`);
                    }
                    break;
            }
        } catch (e) { console.log("P2P Message Error:", e.message); }
    });

    ws.send(JSON.stringify({ type: 'QUERY_CHAIN' }));
}


// Add these variables to your existing p2p-node.js
let shareChain = []; 
const PPLNS_WINDOW = 2160; // Similar to Monero (last ~6 hours of effort)
const POOL_DIFF = "0000";   // Easier than Mainnet Diff

// Add this utility function to p2p-node.js
function validateHash(hash, difficulty) {
    // This checks if the hash starts with the required number of zeros
    return hash.startsWith(difficulty);
}

function handleShareSubmission(minerAddress, shareHash, blockData) {
    // 1. Validate the share meets Pool Difficulty
    if (validateHash(shareHash, POOL_DIFF)) {
        
        // Add to the Share Chain (The Sidechain)
        const shareEntry = {
            miner: minerAddress,
            timestamp: Date.now(),
            hash: shareHash
        };
        
        shareChain.push(shareEntry);

        // Keep the window size fixed (PPLNS logic)
        if (shareChain.length > PPLNS_WINDOW) {
            shareChain.shift(); 
        }

        console.log(`Share added to Sidechain: ${minerAddress}. Total chain size: ${shareChain.length}`);

        // 2. Check if this share is strong enough for the MAIN HUSTL NETWORK
        if (validateHash(shareHash, MAINNET_DIFF)) {
            console.log("🚀 GOLDEN BLOCK FOUND BY POOL!");
            
            // Generate the Payout Map based on the last N shares
            const payouts = calculatePPLNSPayouts();
            
            const goldenBlock = {
                ...blockData,
                hash: shareHash,
                payouts: payouts, // The block itself contains the split instructions
                type: "P2Pool_Block"
            };

            broadcastToNetwork(goldenBlock);
        }
    }
}

function calculatePPLNSPayouts() {
    let stats = {};
    const totalReward = 3.0; // Your block reward

    // Count how many shares each of the 73 cloners has in the current window
    shareChain.forEach(share => {
        stats[share.miner] = (stats[share.miner] || 0) + 1;
    });

    const totalSharesInWindow = shareChain.length;
    let payoutSchedule = [];

    for (let miner in stats) {
        let sharePercentage = stats[miner] / totalSharesInWindow;
        payoutSchedule.push({
            address: miner,
            amount: (sharePercentage * totalReward).toFixed(8)
        });
    }

    return payoutSchedule;
}

function handleNewBlock(block) {
    const latest = HustlerCoin.getLatestBlock();
    if (block.index > latest.index && block.previousHash === latest.hash) {
        HustlerCoin.chain.push(block);
        HustlerCoin.saveChain();
        console.log(`${color.cyan}[P2P] New block received: ${block.index}${color.reset}`);
        broadcast({ type: 'BLOCK', data: block });
    }
}

function handleNewTransaction(txData) {
    try {
        const tx = new Transaction(
            txData.fromAddress, 
            txData.toAddress, 
            txData.amount, 
            txData.timestamp
        );
        tx.signature = txData.signature;
        HustlerCoin.addTransaction(tx);
        console.log(`${color.yellow}[P2P] New transaction received via peer.${color.reset}`);
    } catch (e) { /* Invalid peer tx */ }
}

function broadcast(message) {
    sockets.forEach(s => {
        if (s.readyState === WebSocket.OPEN) {
            s.send(JSON.stringify(message));
        }
    });
}

function connectToPeers(peers) {
    peers.forEach(peer => {
        const ws = new WebSocket(peer);
        ws.on('open', () => initConnection(ws));
        ws.on('error', () => { /* Peer offline */ });
    });
}

connectToPeers(initialPeers);

function printStats(hPort, pPort) {
    const uptime = new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '');
    console.clear();
    console.log(`${color.white} * ABOUT         HUSTL-DECENTRALIZED/2.0.0${color.reset}`);
    console.log(`${color.white} * CPU           ${os.cpus()[0].model}${color.reset}`);
    console.log(`${color.white} * NODE TYPE     P2P Peer + HTTP Gateway${color.reset}`);
    console.log(``);
    console.log(`${color.green}[${uptime}]${color.reset} ${color.cyan}net  ${color.reset} HTTP API listening on port ${color.yellow}${hPort}${color.reset}`);
    console.log(`${color.green}[${uptime}]${color.reset} ${color.cyan}net  ${color.reset} P2P Node listening on port ${color.yellow}${pPort}${color.reset}`);
    console.log(`${color.gray}-----------------------------------------------------------------------${color.reset}`);
}
