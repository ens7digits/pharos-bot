require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');
const { HttpsProxyAgent } = require('https-proxy-agent');
const randomUseragent = require('random-useragent');
const axios = require('axios');

const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  white: '\x1b[37m',
  bold: '\x1b[1m',
};

const logger = {
  info: (msg) => console.log(`${colors.green}[✓] ${msg}${colors.reset}`),
  wallet: (msg) => console.log(`${colors.yellow}[➤] ${msg}${colors.reset}`),
  warn: (msg) => console.log(`${colors.yellow}[!] ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}[✗] ${msg}${colors.reset}`),
  success: (msg) => console.log(`${colors.green}[+] ${msg}${colors.reset}`),
  loading: (msg) => console.log(`${colors.cyan}[⟳] ${msg}${colors.reset}`),
  step: (msg) => console.log(`${colors.white}[➤] ${msg}${colors.reset}`),
  banner: () => {
    console.log(`${colors.cyan}${colors.bold}`);
    console.log('-------------------------------------------------');
    console.log(' Pharos Testnet Bot - https://x.com/0xEns7digits');
    console.log('-------------------------------------------------');
    console.log(`${colors.reset}\n`);
  },
};

const networkConfig = {
  name: 'Pharos Testnet',
  chainId: 688688,
  rpcUrl: 'https://testnet.dplabs-internal.com',
  currencySymbol: 'PHRS',
};

const tokens = {
  USDC: '0xad902cf99c2de2f1ba5ec4d642fd7e49cae9ee37',
  WPHRS: '0x76aaada469d23216be5f7c596fa25f282ff9b364',
  USDT: '0xed59de2d7ad9c043442e381231ee3646fc3c2939',
};

const contractAddress = '0x1a4de519154ae51200b0ad7c90f7fac75547888a';

const tokenDecimals = {
  WPHRS: 18,
  USDC: 6,
  USDT: 18,
};

// ABI untuk kontrak utama, hanya fungsi multicall yang didefinisikan
const contractAbi = [
  'function multicall(uint256 deadlineOrFlags, bytes[] calldata data) payable', // Sesuaikan nama parameter jika diketahui
];

const erc20Abi = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) public returns (bool)',
];

const loadProxies = () => {
  try {
    const proxies = fs.readFileSync('proxies.txt', 'utf8')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line);
    return proxies;
  } catch (error) {
    logger.warn('No proxies.txt found or failed to load, switching to direct mode');
    return [];
  }
};

const getRandomProxy = (proxies) => {
  return proxies[Math.floor(Math.random() * proxies.length)];
};

const setupProvider = (proxy = null) => {
  if (proxy) {
    logger.info(`Using proxy: ${proxy}`);
    const agent = new HttpsProxyAgent(proxy);
    // Ethers v6 JsonRpcProvider
    return new ethers.JsonRpcProvider(networkConfig.rpcUrl, {
      chainId: networkConfig.chainId,
      name: networkConfig.name,
    }, {
      // fetchOptions dan headers tidak langsung didukung seperti ini di JsonRpcProvider v6
      // Jika custom agent diperlukan, harus dihandle secara berbeda atau menggunakan custom fetch
      // Untuk HttpsProxyAgent, cara di atas adalah yang disarankan oleh dokumentasi ethers
      // Untuk User-Agent, ethers.js tidak secara native mendukung kustomisasi User-Agent per request melalui provider.
      // Jika ini krusial, Anda mungkin perlu menggunakan `ethers.FetchRequest` atau men-subclass provider.
      // Untuk saat ini, kita akan mengandalkan default atau apa yang dikelola oleh HttpsProxyAgent
    });
  } else {
    logger.info('Using direct mode (no proxy)');
    return new ethers.JsonRpcProvider(networkConfig.rpcUrl, {
      chainId: networkConfig.chainId,
      name: networkConfig.name,
    });
  }
};

const pairOptions = [
  { id: 1, from: 'WPHRS', to: 'USDC' },
  { id: 2, from: 'USDC', to: 'WPHRS' },
  { id: 3, from: 'WPHRS', to: 'USDT' },
  { id: 4, from: 'USDT', to: 'WPHRS' },
];

const checkBalanceAndApproval = async (wallet, tokenAddress, tokenSymbol, amount, decimals, spender) => {
  try {
    const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, wallet); // Wallet untuk approval
    const required = ethers.parseUnits(amount.toString(), decimals);

    const allowance = await tokenContract.allowance(wallet.address, spender);
    if (allowance < required) {
      logger.step(`Approving ${amount} ${tokenSymbol} for spender ${spender}...`);
      const approveTx = await tokenContract.approve(spender, ethers.MaxUint256); // Approve MaxUint256
      await approveTx.wait();
      logger.success(`Approval for ${tokenSymbol} completed.`);
    } else {
      logger.info(`Sufficient allowance already granted for ${tokenSymbol}.`);
    }
    return true;
  } catch (error) {
    logger.error(`Approval check/process failed for ${tokenSymbol}: ${error.message}`);
    return false;
  }
};

const getMulticallData = (pair, amount, walletAddress) => {
  try {
    const fromTokenSymbol = pair.from;
    const toTokenSymbol = pair.to;
    const decimals = tokenDecimals[fromTokenSymbol];
    const scaledAmount = ethers.parseUnits(amount.toString(), decimals);

    // Deadline untuk swap internal (bukan multicall utama), misal 5 menit dari sekarang
    const subCallDeadline = ethers.toBigInt(Math.floor(Date.now() / 1000) + 300);

    // Selector untuk fungsi swap internal, contoh: '0x04e45aaf' (perlu diverifikasi)
    // Ini mungkin selector untuk 'exactInputSingle' atau fungsi serupa di kontrak target (Router Uniswap V3 style)
    const swapFunctionSelector = '0x04e45aaf'; // ASUMSI, PERLU DIVERIFIKASI

    // Struktur parameter untuk fungsi swap internal (misal, exactInputSingle)
    // [tokenIn, tokenOut, fee, recipient, amountIn, amountOutMinimum, sqrtPriceLimitX96 atau deadline]
    // Urutan dan arti parameter HARUS sesuai dengan fungsi yang dipanggil oleh `swapFunctionSelector`
    
    let innerCallData;

    if (
      (fromTokenSymbol === 'WPHRS' && (toTokenSymbol === 'USDC' || toTokenSymbol === 'USDT')) ||
      ((fromTokenSymbol === 'USDC' || fromTokenSymbol === 'USDT') && toTokenSymbol === 'WPHRS')
    ) {
      innerCallData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'address', 'uint24', 'address', 'uint256', 'uint256', 'uint160'],
        [
          tokens[fromTokenSymbol],   // tokenIn
          tokens[toTokenSymbol],     // tokenOut
          500,                       // fee
          walletAddress,             // recipient
          scaledAmount,              // amountIn
          ethers.toBigInt(0),        // amountOutMinimum
          ethers.toBigInt(0),        // sqrtPriceLimitX96
        ]
      );
    } else {
      logger.error(`Invalid pair: ${fromTokenSymbol} -> ${toTokenSymbol}`);
      return [];
    }
    // Gabungkan selector dengan data yang di-encode
    return [ethers.concat([swapFunctionSelector, innerCallData])];

  } catch (error)
{
    logger.error(`Failed to generate multicall data: ${error.message}`);
    if (error.stack) {
        logger.error(error.stack);
    }
    return [];
  }
};

const performSwap = async (wallet, provider, swapIndex) => {
  try {
    const pair = pairOptions[swapIndex % pairOptions.length];
    const amount = pair.from === 'WPHRS' ? 0.001 : 0.1;
    const fromTokenSymbol = pair.from;
    const toTokenSymbol = pair.to;

    logger.step(`[Swap ${swapIndex + 1}] Preparing: ${amount} ${fromTokenSymbol} -> ${toTokenSymbol}`);

    const decimals = tokenDecimals[fromTokenSymbol];
    const fromTokenAddress = tokens[fromTokenSymbol];

    // 1. Cek balance
    const tokenContractForBalance = new ethers.Contract(fromTokenAddress, erc20Abi, provider);
    const balance = await tokenContractForBalance.balanceOf(wallet.address);
    const requiredAmount = ethers.parseUnits(amount.toString(), decimals);

    if (balance < requiredAmount) {
      logger.warn(`[Swap ${swapIndex + 1}] Skipping: Insufficient ${fromTokenSymbol} balance. Have: ${ethers.formatUnits(balance, decimals)}, Need: ${amount}`);
      return;
    }
    logger.info(`[Swap ${swapIndex + 1}] ${fromTokenSymbol} balance sufficient: ${ethers.formatUnits(balance, decimals)}`);

    // 2. Cek approval & approve jika perlu
    if (!(await checkBalanceAndApproval(wallet, fromTokenAddress, fromTokenSymbol, amount, decimals, contractAddress))) {
      // Pesan error sudah ada di dalam checkBalanceAndApproval
      return;
    }

    // 3. Siapkan data untuk multicall
    const multicallPayload = getMulticallData(pair, amount, wallet.address);
    if (!multicallPayload || multicallPayload.length === 0 || multicallPayload.some(data => !data || data === '0x')) {
      logger.error(`[Swap ${swapIndex + 1}] Invalid or empty multicall data for ${fromTokenSymbol} -> ${toTokenSymbol}.`);
      return;
    }
    logger.info(`[Swap ${swapIndex + 1}] Multicall payload generated: ${multicallPayload[0].substring(0, 50)}...`);


    // 4. Kirim transaksi multicall
    const mainContract = new ethers.Contract(contractAddress, contractAbi, wallet);
    const gasLimit = ethers.toBigInt(250000); // Naikkan sedikit untuk buffer, atau gunakan estimasi
    
    // Untuk parameter pertama `multicall` (deadlineOrFlags)
    // Coba deadline 5 menit dari sekarang. Jika ini bukan deadline, tapi flags, 0 mungkin lebih cocok.
    const multicallDeadlineOrFlags = ethers.toBigInt(Math.floor(Date.now() / 1000) + 300);
    // Alternatif jika itu flags dan bukan deadline:
    // const multicallDeadlineOrFlags = ethers.toBigInt(0);


    logger.loading(`[Swap ${swapIndex + 1}] Sending multicall transaction with deadline/flags: ${multicallDeadlineOrFlags.toString()}`);
    
    const tx = await mainContract['multicall']( // Gunakan bracket notation untuk menghindari konflik nama
      multicallDeadlineOrFlags,
      multicallPayload,
      {
        gasLimit: gasLimit,
        gasPrice: ethers.toBigInt(0), // Sesuai log error, gasPrice 0 digunakan. Ini tidak umum.
        // value: 0 // Jika multicall tidak payable atau tidak ada ETH yang dikirim
      }
    );

    logger.loading(`[Swap ${swapIndex + 1}] Transaction sent (${tx.hash}). Waiting for confirmation...`);
    const receipt = await tx.wait(1); // Tunggu 1 konfirmasi

    if (receipt && receipt.status === 1) {
      logger.success(`[Swap ${swapIndex + 1}] COMPLETED! TxHash: ${receipt.hash}`);
    } else {
      logger.error(`[Swap ${swapIndex + 1}] FAILED ON-CHAIN. TxHash: ${receipt ? receipt.hash : 'N/A'}`);
      if (receipt) {
        logger.error(`  Receipt Status: ${receipt.status}`);
        logger.error(`  Block Number: ${receipt.blockNumber}`);
        logger.error(`  Gas Used: ${receipt.gasUsed.toString()}`);
      }
       // Mencoba mendapatkan revert reason jika tersedia (Ethers v6)
       try {
        // Ini hanya akan berfungsi jika node RPC mendukung debug_traceTransaction atau serupa
        // dan jika transaksi memang revert dengan reason string.
        // Untuk provider publik, ini mungkin tidak selalu mengembalikan reason.
        // const code = await provider.call({ ...tx, blockTag: receipt.blockNumber -1 }); // panggil ulang di blok sebelum revert
        // const reason = ethers.toUtf8String('0x' + code.substring(138));
        // logger.error(`  Revert Reason (estimated): ${reason}`);
       } catch (e) {
        // logger.warn(`  Could not determine revert reason: ${e.message}`);
       }
    }

  } catch (error) {
    logger.error(`[Swap ${swapIndex + 1}] FAILED: ${error.message}`);
    if (error.code === 'CALL_EXCEPTION') {
        logger.error('  Reason: Transaction reverted.');
        if (error.transaction) {
             logger.error(`    TX Data: to=${error.transaction.to}, from=${error.transaction.from}, data=${error.transaction.data ? error.transaction.data.substring(0,100)+'...' : 'N/A'}`);
        }
        if (error.receipt) {
            logger.error(`    Receipt: hash=${error.receipt.hash}, status=${error.receipt.status}`);
        }
        if (error.reason) { 
            logger.error(`    Revert Reason from error object: ${error.reason}`);
        }
    } else if (error.transactionHash) {
        logger.error(`  Transaction Hash: ${error.transactionHash}`);
    }
    
    if (process.env.DEBUG_FULL_ERROR === 'true' && error.stack) {
        logger.error(`Stack trace: ${error.stack}`);
    }
  }
};

const transferPHRS = async (wallet, provider, transferIndex) => {
  try {
    const amount = 0.000001;
    const randomWallet = ethers.Wallet.createRandom();
    const toAddress = randomWallet.address;
    logger.step(`[Transfer ${transferIndex + 1}] Preparing: ${amount} PHRS to ${toAddress}`);

    const balance = await provider.getBalance(wallet.address);
    const required = ethers.parseEther(amount.toString());

    if (balance < required) {
      logger.warn(`[Transfer ${transferIndex + 1}] Skipping: Insufficient PHRS balance. Have: ${ethers.formatEther(balance)}, Need: ${amount}`);
      return;
    }

    // Get the current nonce
    const nonce = await provider.getTransactionCount(wallet.address, 'latest');
    
    const tx = await wallet.sendTransaction({
      to: toAddress,
      value: required,
      gasLimit: ethers.toBigInt(21000),
      gasPrice: ethers.toBigInt(0),
      nonce: nonce // Explicitly set the nonce
    });

    logger.loading(`[Transfer ${transferIndex + 1}] Transaction sent (${tx.hash}). Waiting for confirmation...`);
    const receipt = await tx.wait(1);

    if (receipt && receipt.status === 1) {
      logger.success(`[Transfer ${transferIndex + 1}] COMPLETED! TxHash: ${receipt.hash}`);
    } else {
      logger.error(`[Transfer ${transferIndex + 1}] FAILED ON-CHAIN. TxHash: ${receipt ? receipt.hash : 'N/A'}`);
    }
  } catch (error) {
    logger.error(`[Transfer ${transferIndex + 1}] FAILED: ${error.message}`);
    if (error.code === 'CALL_EXCEPTION' && error.reason) {
      logger.error(`  Revert Reason: ${error.reason}`);
    }
    if (error.code === 'NONCE_EXPIRED') {
      logger.warn('  Nonce expired, will retry with new nonce');
    }
  }
};

const claimFaucet = async (wallet, proxy = null) => {
  try {
    logger.step(`Checking faucet eligibility for wallet: ${wallet.address}`);

    const message = "pharos";
    const signature = await wallet.signMessage(message);
    // logger.step(`Signed message: ${signature}`); // Komentari agar tidak terlalu verbose

    const loginUrl = `https://api.pharosnetwork.xyz/user/login?address=${wallet.address}&signature=${signature}&invite_code=S6NGMzXSCDBxhnwo`;
    const headers = {
      accept: "application/json, text/plain, */*",
      "accept-language": "en-US,en;q=0.8",
      authorization: "Bearer null", // Ini mungkin perlu diperbarui jika API berubah
      "sec-ch-ua": '"Chromium";v="136", "Brave";v="136", "Not.A/Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-site",
      "sec-gpc": "1",
      Referer: "https://testnet.pharosnetwork.xyz/",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "User-Agent": randomUseragent.getRandom(),
    };

    const axiosConfig = {
      method: 'post',
      url: loginUrl,
      headers,
      httpsAgent: proxy ? new HttpsProxyAgent(proxy) : undefined, // undefined jika tidak ada proxy
      timeout: 15000, // Tambahkan timeout
    };

    logger.loading('Sending login request for faucet...');
    const loginResponse = await axios(axiosConfig);
    const loginData = loginResponse.data;

    if (loginData.code !== 0 || !loginData.data || !loginData.data.jwt) {
      logger.error(`Login failed for faucet: ${loginData.msg || 'Unknown error or no JWT'}`);
      return false;
    }

    const jwt = loginData.data.jwt;
    // logger.success(`Login successful for faucet, JWT: ${jwt.substring(0,20)}...`); // Komentari agar tidak terlalu verbose

    const statusUrl = `https://api.pharosnetwork.xyz/faucet/status?address=${wallet.address}`;
    const statusHeaders = {
      ...headers,
      authorization: `Bearer ${jwt}`,
    };

    logger.loading('Checking faucet status...');
    const statusResponse = await axios({
      method: 'get',
      url: statusUrl,
      headers: statusHeaders,
      httpsAgent: proxy ? new HttpsProxyAgent(proxy) : undefined,
      timeout: 15000,
    });
    const statusData = statusResponse.data;

    if (statusData.code !== 0 || !statusData.data) {
      logger.error(`Faucet status check failed: ${statusData.msg || 'Unknown error or no data'}`);
      return false;
    }

    if (!statusData.data.is_able_to_faucet) {
      const nextAvailable = new Date(statusData.data.avaliable_timestamp * 1000).toLocaleString('en-US', { timeZone: 'Asia/Makassar' });
      logger.warn(`Faucet not available until: ${nextAvailable}`);
      return false;
    }

    const claimUrl = `https://api.pharosnetwork.xyz/faucet/daily?address=${wallet.address}`;
    logger.loading('Claiming faucet...');
    const claimResponse = await axios({
      method: 'post',
      url: claimUrl,
      headers: statusHeaders,
      httpsAgent: proxy ? new HttpsProxyAgent(proxy) : undefined,
      timeout: 15000,
    });
    const claimData = claimResponse.data;

    if (claimData.code === 0) {
      logger.success(`Faucet claimed successfully for ${wallet.address}`);
      return true;
    } else {
      logger.error(`Faucet claim failed: ${claimData.msg || 'Unknown error'}`);
      return false;
    }
  } catch (error) {
    logger.error(`Faucet claim process failed for ${wallet.address}: ${error.message}`);
    if (error.response && error.response.data) {
        logger.error(`Faucet API Error: ${JSON.stringify(error.response.data)}`);
    }
    return false;
  }
};

const performCheckIn = async (wallet, proxy = null) => {
  try {
    logger.step(`Performing daily check-in for wallet: ${wallet.address}`);

    const message = "pharos";
    const signature = await wallet.signMessage(message);
    // logger.step(`Signed message: ${signature}`);

    const loginUrl = `https://api.pharosnetwork.xyz/user/login?address=${wallet.address}&signature=${signature}&invite_code=S6NGMzXSCDBxhnwo`;
    const headers = {
      accept: "application/json, text/plain, */*",
      "accept-language": "en-US,en;q=0.8",
      authorization: "Bearer null",
      "sec-ch-ua": '"Chromium";v="136", "Brave";v="136", "Not.A/Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-site",
      "sec-gpc": "1",
      Referer: "https://testnet.pharosnetwork.xyz/",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "User-Agent": randomUseragent.getRandom(),
    };

    const axiosConfig = {
      method: 'post',
      url: loginUrl,
      headers,
      httpsAgent: proxy ? new HttpsProxyAgent(proxy) : undefined,
      timeout: 15000,
    };

    logger.loading('Sending login request for check-in...');
    const loginResponse = await axios(axiosConfig);
    const loginData = loginResponse.data;

    if (loginData.code !== 0 || !loginData.data || !loginData.data.jwt) {
      logger.error(`Login failed for check-in: ${loginData.msg || 'Unknown error or no JWT'}`);
      return false;
    }

    const jwt = loginData.data.jwt;
    // logger.success(`Login successful for check-in, JWT: ${jwt.substring(0,20)}...`);

    const checkInUrl = `https://api.pharosnetwork.xyz/sign/in?address=${wallet.address}`;
    const checkInHeaders = {
      ...headers,
      authorization: `Bearer ${jwt}`,
    };

    logger.loading('Sending check-in request...');
    const checkInResponse = await axios({
      method: 'post',
      url: checkInUrl,
      headers: checkInHeaders,
      httpsAgent: proxy ? new HttpsProxyAgent(proxy) : undefined,
      timeout: 15000,
    });
    const checkInData = checkInResponse.data;

    if (checkInData.code === 0) {
      logger.success(`Check-in successful for ${wallet.address}`);
      return true;
    } else {
      // Kode 10003 sering berarti sudah check-in
      const alreadyCheckedInMessage = "you have already signed in today";
      if (checkInData.msg && checkInData.msg.toLowerCase().includes(alreadyCheckedInMessage)) {
        logger.warn(`Already checked in today for ${wallet.address}.`);
      } else {
        logger.warn(`Check-in failed/not successful: ${checkInData.msg || 'Unknown error'}`);
      }
      return false;
    }
  } catch (error) {
    logger.error(`Check-in process failed for ${wallet.address}: ${error.message}`);
    if (error.response && error.response.data) {
        logger.error(`Check-in API Error: ${JSON.stringify(error.response.data)}`);
    }
    return false;
  }
};

const countdown = async (durationSeconds = 30 * 60) => {
  logger.info(`Starting countdown for ${durationSeconds / 60} minutes...`);

  for (let seconds = durationSeconds; seconds >= 0; seconds--) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    process.stdout.write(`\r${colors.cyan}Time remaining: ${minutes}m ${secs}s${colors.reset} `);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  process.stdout.write('\rCountdown complete! Restarting process...\n');
};

const main = async () => {
  logger.banner();

  const proxies = loadProxies();
  const privateKeys = [process.env.PRIVATE_KEY_1, process.env.PRIVATE_KEY_2, process.env.PRIVATE_KEY_3, process.env.PRIVATE_KEY_4].filter(pk => pk && pk.trim() !== '');
  if (!privateKeys.length) {
    logger.error('No valid private keys found in .env. Ensure PRIVATE_KEY_1 (and optionally PRIVATE_KEY_2) are set.');
    return;
  }
  logger.info(`Loaded ${privateKeys.length} private key(s).`);
  if (proxies.length > 0) {
    logger.info(`Loaded ${proxies.length} proxies.`);
  } else {
    logger.warn('Running in direct mode (no proxies).');
  }

  const numSwapsPerWallet = parseInt(process.env.NUM_SWAPS_PER_WALLET) || 10; // Default 5 swap
  const numTransfersPerWallet = parseInt(process.env.NUM_TRANSFERS_PER_WALLET) || 5; // Default 5 transfer
  const delayBetweenActionsMs = (parseInt(process.env.DELAY_ACTIONS_SEC) || 5) * 1000; // Default 5 detik
  const delayBetweenWalletsMs = (parseInt(process.env.DELAY_WALLETS_SEC) || 10) * 1000; // Default 10 detik
  const mainLoopDelayMinutes = parseInt(process.env.MAIN_LOOP_DELAY_MIN) || 120; // Default 30 menit

  logger.info(`Configuration: Swaps/wallet=${numSwapsPerWallet}, Transfers/wallet=${numTransfersPerWallet}, ActionDelay=${delayBetweenActionsMs/1000}s, WalletDelay=${delayBetweenWalletsMs/1000}s, LoopDelay=${mainLoopDelayMinutes}min`);


  let walletIndex = 0;
  while (true) {
    for (const privateKey of privateKeys) {
      walletIndex++;
      logger.info(`\n--- Processing Wallet ${walletIndex}/${privateKeys.length} ---`);
      const proxy = proxies.length ? getRandomProxy(proxies) : null;
      const provider = setupProvider(proxy); // Provider di-setup ulang per wallet untuk rotasi proxy
      const wallet = new ethers.Wallet(privateKey, provider);

      logger.wallet(`Using wallet: ${wallet.address}`);

      // 1. Claim Faucet
      await claimFaucet(wallet, proxy);
      await new Promise(resolve => setTimeout(resolve, delayBetweenActionsMs));

      // 2. Perform Check-in
      await performCheckIn(wallet, proxy);
      await new Promise(resolve => setTimeout(resolve, delayBetweenActionsMs));

      // 3. Perform PHRS Transfers
      logger.step(`Starting ${numTransfersPerWallet} PHRS transfers...`);
      for (let i = 0; i < numTransfersPerWallet; i++) {
        await transferPHRS(wallet, provider, i);
        if (i < numTransfersPerWallet - 1) { // Jangan delay setelah aksi terakhir
            await new Promise(resolve => setTimeout(resolve, delayBetweenActionsMs));
        }
      }
      logger.success(`${numTransfersPerWallet} PHRS transfers attempted.`);
      await new Promise(resolve => setTimeout(resolve, delayBetweenActionsMs));


      // 4. Perform Swaps
      logger.step(`Starting ${numSwapsPerWallet} token swaps...`);
      for (let i = 0; i < numSwapsPerWallet; i++) {
        await performSwap(wallet, provider, i);
        if (i < numSwapsPerWallet - 1) { // Jangan delay setelah aksi terakhir awdawd
            await new Promise(resolve => setTimeout(resolve, delayBetweenActionsMs));
        }
      }
      logger.success(`${numSwapsPerWallet} token swaps attempted.`);
      
      if (privateKeys.length > 1 && walletIndex < privateKeys.length) {
        logger.info(`Waiting ${delayBetweenWalletsMs/1000} seconds before next wallet...`);
        await new Promise(resolve => setTimeout(resolve, delayBetweenWalletsMs));
      }
    }
    walletIndex = 0; // Reset index untuk loop berikutnya
    logger.success('All actions completed for all wallets in this cycle!');
    await countdown(mainLoopDelayMinutes * 60);
  }
};

main().catch(error => {
  logger.error(`Bot encountered a critical failure: ${error.message}`);
  if (error.stack) {
    logger.error(error.stack);
  }
  process.exit(1);
});
