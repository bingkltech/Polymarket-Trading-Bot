import { ClobClient, SignatureType } from "@polymarket/clob-client";
import { ethers } from "ethers";
import * as fs from "fs";

async function main() {
    try {
        const envContent = fs.readFileSync(".env", "utf8");
        const pkMatch = envContent.match(/POLYGON_PRIVATE_KEY="?([^"\n]+)"?/);
        if (!pkMatch) {
            console.error("Could not find POLYGON_PRIVATE_KEY in .env");
            return;
        }
        const privateKey = pkMatch[1];
        
        const proxyMatch = envContent.match(/POLYMARKET_PROXY_ADDRESS="?([^"\n]+)"?/);
        const proxyAddress = proxyMatch ? proxyMatch[1] : undefined;

        // Default RPC for polygon mainnet
        const provider = new ethers.providers.JsonRpcProvider("https://polygon.llamarpc.com");
        const wallet = new ethers.Wallet(privateKey, provider);
        
        console.log("Authenticating with Wallet Address:", wallet.address);

        // Instantiate client for Polygon Mainnet (137)
        // Pass 2 for SignatureType.POLYMARKET_PROXY
        const clobClient = new ClobClient("https://clob.polymarket.com", 137, wallet, undefined, 2, proxyAddress);

        console.log("Requesting new API key from Polymarket CLOB...");
        const creds: any = await clobClient.deriveApiKey();
        
        console.log("Successfully generated API keys:", creds);
        
        const apiKey = creds.apiKey || creds.key;
        const secret = creds.secret;
        const passphrase = creds.passphrase;

        let newEnv = envContent
            .replace(/POLYMARKET_API_KEY=".*"/, `POLYMARKET_API_KEY="${apiKey}"`)
            .replace(/POLYMARKET_SECRET=".*"/, `POLYMARKET_SECRET="${secret}"`)
            .replace(/POLYMARKET_PASSPHRASE=".*"/, `POLYMARKET_PASSPHRASE="${passphrase}"`);
            
        fs.writeFileSync(".env", newEnv);
        console.log("Updated .env file with the new POLYMARKET_API_KEY, POLYMARKET_SECRET, and POLYMARKET_PASSPHRASE.");

    } catch (error) {
        console.error("Error generating API keys:", error);
    }
}

main();
