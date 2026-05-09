const CryptoJS = require('crypto-js');
const EC = require('elliptic').ec;
const ec = new EC('secp256k1');
const fs = require('fs');
const crypto = require('crypto');

class Transaction {
    constructor(fromAddress, toAddress, amount, timestamp) {
        this.fromAddress = fromAddress;
        this.toAddress = toAddress;
        this.amount = amount;
        this.timestamp = timestamp || Date.now();
        this.signature = '';
    }

    calculateHash() {
        // Ensure consistent hashing across all platforms by forcing String types
        const data = (this.fromAddress || "") + 
                     (this.toAddress || "") + 
                     String(this.amount) + 
                     String(this.timestamp);
        
        return CryptoJS.SHA256(data).toString();
    }

    isValid() {
        if (this.fromAddress === null) return true; // Mining reward

        if (!this.signature || this.signature.length === 0) {
            throw new Error('No signature in this transaction');
        }

        const publicKey = ec.keyFromPublic(this.fromAddress, 'hex');
        const hash = this.calculateHash();

        // The 'hex' argument is required to verify the hash as a hex string
        return publicKey.verify(hash, this.signature);
    }
}

class Block {
    constructor(timestamp, transactions, previousHash = '') {
        this.timestamp = timestamp;
        this.transactions = transactions;
        this.previousHash = previousHash;
        this.nonce = 0;
        this.hash = this.calculateHash();
    }

    calculateHash() {
        return crypto.createHash('sha256')
            .update(this.previousHash + this.timestamp + JSON.stringify(this.transactions) + this.nonce)
            .digest('hex');
    }

    mineBlock(difficulty) {
        while (this.hash.substring(0, difficulty) !== Array(difficulty + 1).join("0")) {
            this.nonce++;
            this.hash = this.calculateHash();
        }
    }
}

class Blockchain {
    constructor() {
        this.difficulty = 6;
        this.miningReward = 3;
        this.pendingTransactions = [];
        this.chain = [this.createGenesisBlock()];
    }

    createGenesisBlock() {
        const reserveTx = new Transaction(null, "04d6ddb6431bd7d3d35c965903455cf30a141e1260b532dead7aa055ed389a57368312a2d370b1487d05c6f35575f9a090b6839ef613b946dce1a44fe0bee60224", 5000000);
        return new Block(1775501353000, [reserveTx], "0");
    }

    getLatestBlock() {
        return this.chain[this.chain.length - 1];
    }

    getBalanceOfAddress(address) {
        let balance = 0;
        for (const block of this.chain) {
            for (const trans of block.transactions) {
                if (trans.fromAddress === address) balance -= trans.amount;
                if (trans.toAddress === address) balance += trans.amount;
            }
        }
        return balance;
    }

    addTransaction(transaction) {
        if (!transaction.fromAddress || !transaction.toAddress) {
            throw new Error('Transaction must include from and to address');
        }

        // Reconstruct the transaction object to access methods
        const tx = new Transaction(
            transaction.fromAddress, 
            transaction.toAddress, 
            transaction.amount, 
            transaction.timestamp
        );
        tx.signature = transaction.signature;

        if (!tx.isValid()) {
            console.log("❌ Signature Verification Failed for:", transaction.fromAddress);
            throw new Error('Invalid Transaction: Signature mismatch');
        }

        const walletBalance = this.getBalanceOfAddress(transaction.fromAddress);
        if (walletBalance < transaction.amount) {
            console.log(`❌ Insufficient Funds! Has: ${walletBalance}, Needs: ${transaction.amount}`);
            throw new Error('Invalid Transaction: Not enough balance');
        }

        this.pendingTransactions.push(tx);
        console.log("✅ Transaction verified and added to pool.");
    }

    minePendingTransactions(miningRewardAddress, rewardData) {
    // Instead of creating one reward transaction of 3 coins, 
    // we create a transaction for every person in the rewardData list.
    
    rewardData.forEach(payment => {
        const rewardTx = new Transaction(null, payment.address, parseFloat(payment.amount));
        this.pendingTransactions.push(rewardTx);
    });

    // Create the block with these transactions
    let block = new Block(Date.now(), this.pendingTransactions, this.getLatestBlock().hash);
    block.mineBlock(this.difficulty);

    this.chain.push(block);
    this.pendingTransactions = [];
}

    saveChain() {
        try {
            fs.writeFileSync('./ledger.json', JSON.stringify(this.chain, null, 2));
            console.log("💾 Ledger updated.");
        } catch (err) {
            console.error("❌ Save Error:", err.message);
        }
    }

    loadChain() {
        if (fs.existsSync('./ledger.json')) {
            const data = fs.readFileSync('./ledger.json', 'utf8');
            this.chain = JSON.parse(data);
            console.log("📂 Ledger loaded from disk.");
        }
    }
}

module.exports = { Blockchain, Transaction, Block };