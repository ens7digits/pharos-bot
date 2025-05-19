# Pharos Testnet Auto Bot

An automated bot for interacting with the Pharos Testnet, including tasks like swaps, faucet claims, and daily check-ins to potentially qualify for airdrops.

## Features ✨

- **Automated Swaps**: Performs random swaps between WPHRS and USDC tokens.
- **PHRS Transfers**: Sends small amounts of PHRS to random addresses.
- **Faucet Claims**: Automatically claims testnet tokens from the faucet.
- **Daily Check-ins**: Completes daily tasks for potential rewards.
- **Proxy Support**: Rotates proxies for each operation (optional).
- **Multi-wallet Support**: Handles multiple wallets through `.env`.

## Prerequisites 🛠️

- **Node.js v16+** or higher
- **npm** (Node Package Manager) or **yarn**
- Pharos Testnet wallet with private keys.
- (Optional) Proxy list in `proxies.txt` for proxy rotation.

## How to Use 📋

Follow these steps to set up and run the bot:

1. **Clone the repository:**

   ```bash
   git clone https://github.com/ens7digits/pharos-bot.git
   cd pharos-bot
#!/bin/bash

# 1. Create the Project Directory and Navigate Into It
mkdir pharos-bot && cd pharos-bot

# 2. Initialize Node.js Project
npm init -y

# 3. Install Required Dependencies
npm install axios dotenv ethers

# 4. Create the .env file with necessary environment variables
echo -e "WALLETS=your_private_key1,your_private_key2\nRPC_URL=https://rpc.pharosnetwork.xyz\nFAUCET_URL=https://faucet.pharosnetwork.xyz" > .env

# 5. (Optional) Create proxies.txt file if using proxies
echo -e "http://127.0.0.1:8080\nhttp://127.0.0.2:8080" > proxies.txt

# 6. Create the index.js file for the bot logic (can be filled with your bot code later)
touch index.js

echo "Project setup completed! Please update .env, proxies.txt, and index.js as needed."

