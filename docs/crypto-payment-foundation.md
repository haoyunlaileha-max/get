# Direct-wallet cryptocurrency payment

## Assets and receiving addresses

The database has nine configured assets: BTC, ETH, USDT ERC-20, USDT TRC-20, LTC, TRX, SOL, BNB BEP-20 and GRAM on TON. XMR is excluded.

The GRAM row uses the previously configured TON receiving wallet, ticker/display name GRAM, and the TON/GRAM network label. The quote adapter maps this legacy GRAM label to the TON/USDT market symbol. The actual GRAM Jetton master contract has not yet been populated in the asset registry; the current wallet address is a receiving address, not a token contract address. Chain monitoring for this asset must remain disabled until the exact on-chain asset identity is verified.

## USDT pricing and invoice generation

- Catalog plan prices are denominated in USDT (minor units are cents, 2 decimal places).
- Order creation is server-side and rejects plans not priced in USDT.
- The authenticated `create-crypto-invoice` Edge Function obtains a live USDT market quote from Binance public ticker endpoints for BTC, ETH, LTC, TRX, SOL, BNB and TON/GRAM; USDT network payments use a 1:1 quote.
- Amount conversion uses integer arithmetic and each asset's atomic precision.
- The database allocates a unique active invoice amount per asset and stores the quote, expiry and expected atomic amount.
- Customers can select the asset/network after creating an order.

## Safety state and deployment boundary

The schema, USDT pricing path, authenticated invoice endpoint and checkout UI are deployed. However, all nine chain listeners remain disabled with `listener_status = awaiting_provider`. The invoice endpoint intentionally refuses to issue a payment address while the selected chain listener is offline, so customers cannot send funds into a flow that cannot reliably detect and credit them.

No private keys or seed phrases are stored. No chain listener or scheduled scanner is active. The remaining production boundary is chain-specific transaction indexing, confirmation/reorg handling, a scheduler, and verification of the GRAM Jetton master contract. A successful website/Edge Function deployment does not mean automatic on-chain settlement is active.
