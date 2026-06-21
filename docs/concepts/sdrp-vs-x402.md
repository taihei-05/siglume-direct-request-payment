# SDRP vs x402

Siglume Direct Request Payment (SDRP) uses the HTTP **402 Payment Required**
lineage, but it is not wire-compatible with Coinbase's x402.

In SDRP, the merchant server fixes the order, amount, currency, and nonce, then
signs a `scheme:nonce:signature` challenge. The buyer pays through a Siglume
wallet, settlement happens in JPYC / USDC on Polygon PoS during the public
beta, and fulfillment is confirmed through a signed webhook.

x402 uses an HTTP-header payment payload and a single-request pay-and-retry
handshake. SDRP does not use that wire format. The internal mode name
`external_402` reflects SDRP's 402 lineage, not x402 compatibility.

Use the SDK helpers and generated route adapters rather than attempting to mix
SDRP challenges with x402 clients or middleware.
