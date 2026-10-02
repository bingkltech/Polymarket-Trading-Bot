const ethers = require('ethers');

// ethers v5 syntax
const provider = new ethers.providers.JsonRpcProvider('https://rpc.ankr.com/polygon');
const usdcAddress = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'; 
const abi = ['function balanceOf(address owner) view returns (uint256)'];
const contract = new ethers.Contract(usdcAddress, abi, provider);

async function main() {
    try {
        const balance = await contract.balanceOf('0xF08F229E60D264A30462Be5915253Adf84D90a70');
        console.log('USDC.e Balance:', ethers.utils.formatUnits(balance, 6));

        // Let's also check MATIC balance
        const maticBal = await provider.getBalance('0xF08F229E60D264A30462Be5915253Adf84D90a70');
        console.log('MATIC Balance:', ethers.utils.formatEther(maticBal));
    } catch (e) {
        console.error(e);
    }
}

main();
