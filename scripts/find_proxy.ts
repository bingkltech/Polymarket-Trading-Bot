import { ClobClient } from "@polymarket/clob-client";
import { ethers } from "ethers";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

async function getProfile() {
    let RPC_URL = `https://polygon-mainnet.g.alchemy.com/v2/${process.env.Alchemy_Api || "alch_pQ3LieTbzyQLbJCYf0xHi"}`;
    const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(process.env.Wallet_Private_Key || process.env.POLYGON_PRIVATE_KEY!, provider);

    const clobClient = new ClobClient(
        "https://clob.polymarket.com",
        137,
        wallet,
        {
            key: process.env.POLYMARKET_API_KEY!,
            secret: process.env.POLYMARKET_SECRET!,
            passphrase: process.env.POLYMARKET_PASSPHRASE!,
        }
    );

    try {
        console.log("Deriving API key...");
        await clobClient.deriveApiKey();
        console.log("Fetching allowances...");
        const allowances = await clobClient.getAllowances();
        console.log("Allowances:", allowances);
        const orders = await clobClient.getOrders({ status: "all" });
        console.log(`Found ${orders.length} historical/open orders.`);
    } catch (e) {
        console.error("Error", e);
    }
}
getProfile();
