import { ClobClient } from "@polymarket/clob-client";
import { ethers } from "ethers";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const POLYGON_CHAIN_ID = 137;
// Reconstruct Polygon RPC from Alchemy API Key
let RPC_URL = `https://polygon-mainnet.g.alchemy.com/v2/${process.env.Alchemy_Api || "alch_pQ3LieTbzyQLbJCYf0xHi"}`;

const PRIVATE_KEY = process.env.Wallet_Private_Key || process.env.POLYGON_PRIVATE_KEY!;
const PROXY_ADDRESS = process.env.Signer_Address || process.env.POLYMARKET_PROXY_ADDRESS!;
const PM_WALLET = process.env.Polymarket_wallet_Address;
const USDC_E_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"; // USDC.e (Bridged)
const USDC_NATIVE_ADDRESS = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"; // USDC (Native)
const PUSD_ADDRESS = "0xc011a7e12a19f7b1f670d46f03b03f3342e82dfb"; // Polymarket USD (pUSD)

const ERC20_ABI = [
    "function balanceOf(address owner) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)"
];

async function runIntegrityCheck() {
    console.log("=========================================");
    console.log("🛡️  QUANT MANAGER INTEGRITY CHECK  🛡️");
    console.log("=========================================\n");

    const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
    let wallet: ethers.Wallet;

    try {
        wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    } catch (e) {
        console.error("❌ CRITICAL: Invalid POLYGON_PRIVATE_KEY.");
        return;
    }

    // 1. RPC Health Check
    process.stdout.write("Checking RPC Provider Health... ");
    try {
        const start = Date.now();
        const blockNumber = await provider.getBlockNumber();
        const latency = Date.now() - start;
        console.log(`✅ OK (Block: ${blockNumber}, Latency: ${latency}ms)`);
    } catch (error: any) {
        console.log(`❌ FAILED (${error.message})`);
        console.error("CRITICAL: Cannot connect to Polygon network.");
        return;
    }

    console.log(`\nWallet Address (Signer): ${wallet.address}`);
    console.log(`Polymarket Proxy Address: ${PROXY_ADDRESS}`);

    // 2. Balances Check
    console.log("\nChecking On-Chain Balances...");
    try {
        const maticBalance = await wallet.getBalance();
        console.log(`MATIC Balance: ${ethers.utils.formatEther(maticBalance)} MATIC (Used for Gas)`);
        if (maticBalance.lt(ethers.utils.parseEther("0.1"))) {
            console.warn("⚠️  WARNING: Low MATIC balance. Transactions may fail.");
        }

        const usdcEContract = new ethers.Contract(USDC_E_ADDRESS, ERC20_ABI, provider);
        const usdcNativeContract = new ethers.Contract(USDC_NATIVE_ADDRESS, ERC20_ABI, provider);
        
        const usdcEBalanceSigner = await usdcEContract.balanceOf(wallet.address);
        const usdcNativeBalanceSigner = await usdcNativeContract.balanceOf(wallet.address);
        console.log(`Signer USDC.e Balance: ${ethers.utils.formatUnits(usdcEBalanceSigner, 6)} USDC`);
        console.log(`Signer Native USDC Balance: ${ethers.utils.formatUnits(usdcNativeBalanceSigner, 6)} USDC`);
        
        if (PROXY_ADDRESS !== wallet.address) {
            const usdcEBalanceProxy = await usdcEContract.balanceOf(PROXY_ADDRESS);
            console.log(`Proxy USDC.e Balance: ${ethers.utils.formatUnits(usdcEBalanceProxy, 6)} USDC`);
        }

        if (PM_WALLET) {
            const pusdContract = new ethers.Contract(PUSD_ADDRESS, ERC20_ABI, provider);
            const usdcEBalancePM = await usdcEContract.balanceOf(PM_WALLET);
            const usdcNativeBalancePM = await usdcNativeContract.balanceOf(PM_WALLET);
            const pusdBalancePM = await pusdContract.balanceOf(PM_WALLET);
            console.log(`Polymarket Wallet (${PM_WALLET}) USDC.e Balance: ${ethers.utils.formatUnits(usdcEBalancePM, 6)} USDC`);
            console.log(`Polymarket Wallet (${PM_WALLET}) Native USDC Balance: ${ethers.utils.formatUnits(usdcNativeBalancePM, 6)} USDC`);
            console.log(`Polymarket Wallet (${PM_WALLET}) pUSD Balance: ${ethers.utils.formatUnits(pusdBalancePM, 6)} pUSD`);
        }
    } catch (error: any) {
        console.log(`❌ FAILED to fetch balances (${error.message})`);
    }

    // 3. Polymarket CLOB Connection Check
    console.log("\nChecking Polymarket CLOB Connection & Credentials...");
    try {
        const clobClient = new ClobClient(
            "https://clob.polymarket.com",
            POLYGON_CHAIN_ID,
            wallet,
            {
                key: process.env.POLYMARKET_API_KEY!,
                secret: process.env.POLYMARKET_SECRET!,
                passphrase: process.env.POLYMARKET_PASSPHRASE!,
            }
        );

        const start = Date.now();
        const isValid = await clobClient.deriveApiKey(); 
        // deriveApiKey is a good way to test if credentials are valid and signable
        // Alternatively we can fetch a market to test read
        const markets = await clobClient.getMarkets({ limit: 1 });
        const latency = Date.now() - start;

        if (markets && markets.data && markets.data.length > 0) {
            console.log(`✅ CLOB Read Access OK (Latency: ${latency}ms)`);
        } else {
            console.log(`⚠️ CLOB Read Access returned no markets`);
        }

        console.log("✅ API Credentials formatted correctly.");
    } catch (error: any) {
        console.log(`❌ CLOB Connection FAILED (${error.message})`);
        console.log("Verify your POLYMARKET_API_KEY, SECRET, and PASSPHRASE.");
    }

    console.log("\n=========================================");
    console.log("🏁 INTEGRITY CHECK COMPLETE");
    console.log("=========================================");
}

runIntegrityCheck().catch(console.error);
