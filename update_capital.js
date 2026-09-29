const fs = require('fs');
const yaml = require('yaml');

const content = fs.readFileSync('config.yaml', 'utf8');
const doc = yaml.parseDocument(content);

const wallets = doc.get('wallets');
if (wallets && wallets.items) {
  for (const wallet of wallets.items) {
    if (wallet.get('capital') !== undefined) {
      wallet.set('capital', 25);
    }
  }
}

fs.writeFileSync('config.yaml', doc.toString({ lineWidth: 0 }));
console.log('Updated all wallets to 25 capital.');
