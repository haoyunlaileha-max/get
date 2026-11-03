# Direct-wallet crypto payment foundation

## Configured public receiving addresses

The Supabase table `public.ah_crypto_assets` contains the nine requested assets/networks:
BTC, ETH, USDT ERC-20, USDT TRC-20, LTC, TRX, SOL, BNB BEP-20, and TON.

XMR was explicitly removed. The supplied EVM address is shared by ETH, ERC-20 USDT, and BNB BEP-20; the supplied TRON address is shared by TRX and TRC-20 USDT. These are separate network assets despite sharing an address string.

The TON wallet address is configured for the native TON network. The native asset ticker is TON; "GRAM" is retained only as the user's requested label because GRAM is not the current native TON ticker. A separate GRAM jetton would require its jetton master contract address.

## Safety state

All listeners are deliberately disabled with `listener_status = awaiting_provider`. Public wallet addresses are not credentials. No private keys, seed phrases, or signing capability are stored.

The schema provides:
- per-asset precision in atomic units (BTC/LTC 8, ETH/BNB 18, USDT 6, TRX 6, SOL/TON 9);
- unique active invoice amount per asset;
- deposit and transfer records with transaction/event deduplication;
- confirmation and reorg states;
- per-chain scan cursors and health counters.

## Required before real-time monitoring

Configure reliable RPC/indexer endpoints and credentials for Bitcoin, Litecoin, Ethereum, BNB Smart Chain, TRON, Solana, and TON, then deploy a chain-specific scanner and schedule it. Do not enable listeners until each chain's scanner, cursor persistence, confirmation policy, reorg handling, and amount matching have been verified. Fiat-to-crypto quotes are also required because current product prices are denominated in fiat.

The payment UI must not claim that a deposit is monitored or confirmed until those services are active.
