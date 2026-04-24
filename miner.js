const axios = require('axios');
const crypto = require('crypto');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// --- CONFIGURATION ---
const SERVER_URL = 'http://localhost:3000'; 
let minerAddress = process.argv[2] || ""; 
let hashesDone = 0;
let acceptedJobs = 0;
let startTime = Date.now();

async function startMining() {
    // Keep header clean for .bat info
    if (minerAddress && minerAddress.length > 10) {
        runMining();
    } else {
        rl.question('\x1b[33m👤 Enter Wallet Address: \x1b[0m', (addr) => {
            minerAddress = addr.trim();
            runMining();
        });
    }
}

function runMining() {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`\x1b[32m[${timestamp}]\x1b[0m \x1b[36mnet  \x1b[0m \x1b[32mREADY\x1b[0m connected to \x1b[33m${SERVER_URL}\x1b[0m`);
    rl.close(); 
    
    // Log speed/stats every 30 seconds
    setInterval(logStatus, 30000); 
    mineLoop();
}

async function mineLoop() {
    while (true) {
        try {
            // Get current chain info from your P2P node
            const response = await axios.get(`${SERVER_URL}/mining-info`);
            const { lastHash, difficulty } = response.data;

            let nonce = 0;
            let hash = "";
            
            while (true) {
                // Simplified P2P-compatible hashing (matching your node's logic)
                hash = crypto.createHash('sha256')
                    .update(lastHash + minerAddress + nonce)
                    .digest('hex');
                
                hashesDone++;
                
                if (hash.startsWith('0'.repeat(difficulty))) {
                    const successTime = new Date().toLocaleTimeString();
                    acceptedJobs++;
                    
                    console.log(`\x1b[32m[${successTime}]\x1b[0m \x1b[34mcpu  \x1b[0m \x1b[32maccepted\x1b[0m share found! (total: ${acceptedJobs})`);
                    
                    await submitBlock(nonce, hash);
                    break; 
                }
                nonce++;
                
                // Allow Node.js to breathe every 10k hashes
                if (nonce % 10000 === 0) {
                    await new Promise(resolve => setImmediate(resolve));
                }
            }
        } catch (err) {
            const errorTime = new Date().toLocaleTimeString();
            console.log(`\x1b[31m[${errorTime}] [!] net  connection error (is p2p-node running?). retrying...\x1b[0m`);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

async function submitBlock(nonce, hash) {
    const elapsedSec = (Date.now() - startTime) / 1000;
    const currentHashrate = (hashesDone / elapsedSec).toFixed(2);
    
    try {
        await axios.post(`${SERVER_URL}/mine`, {
            minerAddress: minerAddress,
            hashrate: currentHashrate 
        });
    } catch (err) {
        // Silent fail if node is busy
    }
}

function logStatus() {
    const elapsedSec = (Date.now() - startTime) / 1000;
    const currentHashrate = (hashesDone / elapsedSec).toFixed(2);
    const timestamp = new Date().toLocaleTimeString();
    
    console.log(`\x1b[32m[${timestamp}]\x1b[0m \x1b[36mminer\x1b[0m speed: \x1b[32m${currentHashrate} H/s\x1b[0m | acc: \x1b[32m${acceptedJobs}\x1b[0m`);
}

startMining();