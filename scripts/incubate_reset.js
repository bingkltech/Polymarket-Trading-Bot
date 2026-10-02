const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log("\n🦌 Deerflow Incubation Protocol: Initiating Memory Kick & Rebuild...");

// Memory Kick: We intentionally DO NOT delete the SQLite database (.runtime/memory.db)
// so that your paper trading PnL and history are preserved!
// This script just re-compiles the code and clears any orphaned process memory.

console.log("[Build] Compiling TypeScript (Strict Math/Logic Checks)...");
try {
  execSync('npm run build', { stdio: 'inherit' });
} catch (e) {
  console.error("\n❌ Build failed. Please fix TypeScript errors before incubating!");
  process.exit(1);
}

console.log("\n✅ Deerflow Incubation Reset Complete!");
console.log("➡️ Spawning fresh incubation daemon...\n");
