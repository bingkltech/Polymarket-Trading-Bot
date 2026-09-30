import { ethers } from "ethers";
import * as fs from "fs";

async function main() {
    try {
        const envContent = fs.readFileSync(".env", "utf8");
        const extract = (key: string) => {
            const match = envContent.match(new RegExp(`${key}="([^"]+)"`));
            return match ? match[1] : undefined;
        };

        const proxyAddress = extract("POLYMARKET_PROXY_ADDRESS");
        const privateKey = extract("POLYGON_PRIVATE_KEY");

        const provider = new ethers.providers.StaticJsonRpcProvider("https://polygon-rpc.com", 137);
        const wallet = new ethers.Wallet(privateKey as string, provider);

        const usdcAddress = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
        const ctfExchangeAddress = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E"; // CTF Exchange

        const abi = [
            "function balanceOf(address owner) view returns (uint256)",
            "function allowance(address owner, address spender) view returns (uint256)"
        ];
        
        const contract = new ethers.Contract(usdcAddress, abi, provider);

        console.log(`Checking Proxy Wallet: ${proxyAddress}`);
        
        const bal = await contract.balanceOf(proxyAddress);
        console.log(`Live USDC Balance: $${ethers.utils.formatUnits(bal, 6)}`);

        const allow = await contract.allowance(proxyAddress, ctfExchangeAddress);
        console.log(`CTF Exchange Allowance: $${ethers.utils.formatUnits(allow, 6)}`);
        
    } catch (e) {
        console.error("Failed:", e);
    }
}
main();
