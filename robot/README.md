# BLACKBOX robot

Unattended registrar. Runs in GitHub Actions (`.github/workflows/robot.yml`). It files records, lands them, and settles the auction. It has no storage stage: art is rendered on chain.

## Triggers

Push touching `records/**` or `config/**`, manual dispatch, and cron every 15 minutes. Concurrency group `robot`, no cancellation. Runs are skipped when the head commit message contains `[robot-receipt]`.

## Stages

Each stage reads chain state before sending. Re-running a completed stage sends nothing.

1. FILE. For each `records/recNNN/filing.json` without `receipt.filed`:
   - If the chain already holds the record with the same `passHash`, the receipt is rebuilt from the `Filed` event. No transaction is sent.
   - If the chain holds the record with a different `passHash`, the record is refused.
   - Otherwise these guards apply, and any failure is refused and logged:
     - `rec` equals `recordCount() + 1`.
     - `windowOpen` is not more than 15 minutes in the past, unless `allowPastOpen` is true.
     - `deadline` is after now and after `windowOpen`.
     - `cap` equals `capFor(blockMinutes)` and `price` equals `priceFor(cap)`.
   - On pass, `file(...)` is sent, one confirmation awaited, `receipt.filed` written.
2. LAND. For each record with `receipt.filed` and no `receipt.landed`:
   - If the chain shows `landedAt` non-zero, the receipt is rebuilt from the `Landed` event.
   - Otherwise, if the on-chain deadline has passed or the folder contains a file named `LANDED`, `land(rec, dossier)` is sent. `minted` and `cap` are read back from the chain into `receipt.landed`.
3. AUCTION. For each network referenced by a filing, if `auction().end` is non-zero, past, and `settled` is false, `settleAuction()` is sent.

## Refusals and errors

A refusal is logged and the process continues; it does not change the exit code. An unexpected error (RPC failure, revert) is logged, later stages still run, and the process exits 1 at the end. The receipt commit step runs regardless (`if: always()`).

## Gas

Fees come from the provider's fee data. `maxFeePerGas` is capped at 30 gwei. If the latest block base fee exceeds the cap, the send is refused. If wallet balance is below estimated gas times `maxFeePerGas`, the send is refused and logged. Confirmation wait times out after 10 minutes.

## Logging

One line per event: `ISO timestamp | stage | rec | action | tx hash`. The private key and RPC response bodies are never printed. Error text is reduced to an error code and one truncated line, with the key redacted.

## Data

- `records/recNNN/filing.json`: input, written by the session.
- `records/recNNN/receipt.json`: output, written by the robot only.
- `records/recNNN/LANDED`: empty marker pushed by the session to land early.
- `config/chain.json`: contract, RPC, and chainId per network.

The RPC chainId is checked against config before the first send on each network.

## Secrets

`REGISTRAR_KEY` (hex, registrar account). Set in repository settings.

## Local verification

    cd robot
    npm ci
    node selftest.mjs

The self-test uses an in-memory mock contract and makes no network calls. Cases: fresh filing, already-filed idempotency, rec gap, past `windowOpen`, cap/price mismatch, land after deadline, land early via `LANDED`, already-landed no-op, auction settle.
