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

