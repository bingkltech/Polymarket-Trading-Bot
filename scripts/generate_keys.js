const { ClobClient } = require('@polymarket/clob-client');
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function run() {
    console.log("==========================================");
    console.log("   POLYMARKET API KEY GENERATOR");
    console.log("==========================================\n");

    const pk = process.env.POLYGON_PRIVATE_KEY;
    if (!pk || pk.includes('0xae14f45523db')) {
        console.error("❌ ERROR: You must put your REAL Polygon Private Key in the .env file first!");
        console.error("Your .env currently has a fake/placeholder private key.");
        console.error("Open .env, set POLYGON_PRIVATE_KEY to your actual wallet private key, and run this again.\n");
        process.exit(1);
    }

    try {
        console.log("1. Connecting to Polygon...");
        const provider = new ethers.providers.StaticJsonRpcProvider('https://1rpc.io/matic', 137);
        const wallet = new ethers.Wallet(pk, provider);
        
        console.log(`2. Wallet authenticated: ${wallet.address}`);
        console.log("3. Generating and deriving API credentials from Polymarket...");
        
        const client = new ClobClient('https://clob.polymarket.com', 137, wallet);
        
        // Derive credentials using the L1 wallet signature
        const creds = await client.deriveApiKey();

        console.log("\n✅ SUCCESS! Credentials Generated:\n");
        console.log(`API KEY:    ${creds.apiKey}`);
        console.log(`SECRET:     ${creds.secret}`);
        console.log(`PASSPHRASE: ${creds.passphrase}\n`);

        console.log("4. Saving to .env file...");
        
        const envPath = path.join(__dirname, '..', '.env');
        let envFile = fs.readFileSync(envPath, 'utf8');
        
        envFile = envFile.replace(/POLYMARKET_API_KEY=".+"/g, `POLYMARKET_API_KEY="${creds.apiKey}"`);
        envFile = envFile.replace(/POLYMARKET_SECRET=".+"/g, `POLYMARKET_SECRET="${creds.secret}"`);
        envFile = envFile.replace(/POLYMARKET_PASSPHRASE=".+"/g, `POLYMARKET_PASSPHRASE="${creds.passphrase}"`);
        
        fs.writeFileSync(envPath, envFile);
        
        console.log("✅ Done! Your .env file is now configured for live trading.");
        console.log("You can now run: npm run incubate:reset\n");

    } catch (err) {
        console.error("\n❌ FAILED to generate keys:", err.message);
    }
}

run();
