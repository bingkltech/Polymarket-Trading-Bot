import { ClobClient, Side, SignatureType, OrderType } from "@polymarket/clob-client";
import { ethers } from "ethers";
import * as fs from "fs";

async function main() {
    try {
        const envContent = fs.readFileSync(".env", "utf8");
        
        const extract = (key: string) => {
            const match = envContent.match(new RegExp(`${key}="([^"]+)"`));
            return match ? match[1] : undefined;
        };

        const privateKey = extract("POLYGON_PRIVATE_KEY");
        const apiKey = extract("POLYMARKET_API_KEY");
        const apiSecret = extract("POLYMARKET_SECRET");
        const apiPassphrase = extract("POLYMARKET_PASSPHRASE");
        const proxyAddress = extract("POLYMARKET_PROXY_ADDRESS");

        if (!privateKey || !apiKey || !apiSecret || !apiPassphrase) {
            throw new Error("Missing API credentials in .env");
        }

        const provider = new ethers.providers.JsonRpcProvider("https://polygon.llamarpc.com");
        const wallet = new ethers.Wallet(privateKey, provider);

        const creds = {
            key: apiKey,
            secret: apiSecret,
            passphrase: apiPassphrase,
        };

        // Note: 5th arg is SignatureType. We use POLYMARKET_PROXY (2) for Google login wallets
        const clobClient = new ClobClient("https://clob.polymarket.com", 137, wallet, creds, SignatureType.POLYMARKET_PROXY, proxyAddress);

        console.log("Fetching an active market from Gamma API...");
        const response = await fetch("https://gamma-api.polymarket.com/events?closed=false&active=true&limit=1");
        const events = await response.json();
        
        if (!events || events.length === 0) {
            throw new Error("Could not find an active market");
        }
        
        const market = events[0].markets[0];
        // Ensure it has tokens
        if (!market.clobTokenIds || JSON.parse(market.clobTokenIds).length === 0) {
            throw new Error("Market has no CLOB token IDs");
        }
        
        const tokenIDs = JSON.parse(market.clobTokenIds);
        const tokenID = tokenIDs[0]; // the YES token

        console.log(`Target Market: ${market.question}`);
        console.log(`Token ID (YES): ${tokenID}`);

        console.log("\nConstructing test LIMIT order...");
        console.log("- Side: BUY");
        console.log("- Size: 5 shares");
        console.log("- Price: $0.01 (Very far from spread to avoid accidental fill)");

        // 1. Create the order payload and sign it
        const order = await clobClient.createOrder({
            tokenID: tokenID,
            price: 0.01,
            side: Side.BUY,
            size: 5,
            feeRateBps: 1000,
            orderType: OrderType.FOK,
        });

        console.log("\nOrder payload created and signed successfully!");
        
        console.log("\nSubmitting order to Polymarket matching engine...");
        const resp = await clobClient.postOrder(order);

        console.log("\nResponse:", resp);
        
        if (resp && resp.orderID) {
            console.log(`\nTrade placed successfully! Order ID: ${resp.orderID}`);
            
            // Clean up by canceling the test order immediately
            console.log("Canceling the order to clean up...");
            await clobClient.cancelOrder(resp.orderID);
            console.log("Order canceled.");
        } else {
            console.log(`\nOrder rejected by exchange: ${resp.errorMsg || JSON.stringify(resp)}`);
        }

    } catch (e) {
        console.error("Test trade failed:", e);
    }
}

main();
