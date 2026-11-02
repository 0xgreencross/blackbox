# DITHERVOID // BLACKBOX

The chain is the recorder. Every flight writes a record into it that cannot be amended.

Private working repository. Layout:

- contract/  BLACKBOX.sol (ERC-721 + ERC-2981 + ERC-4906), hardhat tests, coat and fetch scripts
- robot/     GitHub Actions robot: files at the gate, lands, settles the 1/1 auction; receipts are ground truth
- machine/   pass decode (PDF417, QR, Aztec, DataMatrix), salted commitment, filing.json, PII gate
- records/   one folder per flight record: filing.json (no PII), receipt.json (robot only)
- config/    chain.json: contract addresses and RPCs
- docs/      decisions and runbook

Privacy: raw boarding pass strings, booking codes, the passenger name and the commitment salt never enter this repository. private/ and source_scans/ are gitignored; machine/gate.py runs before every commit.
