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
const initialPeers = ['ws://197.248.102.155:5001'];

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

    HustlerCoin.minePendingTransactions(minerAddress);
    HustlerCoin.saveChain();

    broadcast({ type: 'BLOCK', data: HustlerCoin.getLatestBlock() });

    const newBalance = HustlerCoin.getBalanceOfAddress(minerAddress);
    console.log(`${color.green}[${timestamp}]${color.reset} ${color.blue}cpu ${color.reset} ${color.green}BLOCK MINED & BROADCASTED${color.reset}`);
    console.log(`${color.white} > Balance: ${color.cyan}${newBalance} HUSTL${color.reset}`);
    
    res.status(200).send("Block Accepted!");
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
