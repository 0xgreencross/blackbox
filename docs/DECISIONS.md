# BLACKBOX decisions (binding; full context in the claude.ai project docs)

Locked by the artist, 2026-11-01 to 2026-11-02:
- Ethereum mainnet; Sepolia rehearsal first.
- Per-flight editions. cap = clamp(round(scheduled block minutes / 60), 1, 13). Minting only during the flight window; unminted supply never exists after landing.
- Price per edition = 0.013 + 0.0536 x (13 - cap) / 12 ETH (cap 1 = 0.0666, cap 13 = 0.013). Replaces the brief's flat 0.015.
- Royalty 6.9% (ERC-2981) to the treasury 0x2bCb25A1934D4696A0d733EF8f514095003C6a18. Every wei received is forwarded in the same transaction; no custody.
- 1/1 complete-journey piece sold by English auction built into the contract, after the last leg.
- Art fully on-chain: the PANDORA v3 engine is read from the 14 GLASS chunk contracts (verified by chained codehash 0x4b3ffe1c...); scene script and Silkscreen font are uploaded once and locked before the first filing.
- Composition: the CURTAIN family (final pick between REFLECTION, AURORA, AMALGAM pending). BONE palette, the loop in its own rolled scheme, Silkscreen type.
- Sealed art shows label and hash only; geometry is route-free (from block minutes). Route, date, seat publish at landing.
- Commitment: passHash = keccak256(payload ++ keccak256(masterSalt ++ uint256(rec))). Salt never in git.
- Deploy: the artist signs in Remix and MetaMask. The robot (ops wallet 0x02A8018D9312c8b89269Cc3761dC95e7BEC21ab8) files and lands.
- Every deployed contract: verified on Etherscan (and Sourcify) and submitted to Blockaid.
- File at boarding call only. Announce route at most, never flight number or exact arrival.
