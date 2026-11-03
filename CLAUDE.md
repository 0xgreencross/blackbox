BLACKBOX :: OPERATOR RULES (Claude Code sessions)

What this is

DITHERVOID // BLACKBOX by GREENCROSS. Every flight files a record on Ethereum at the boarding call; editions mint only while the plane is in the air; at landing the window closes. Contract, art and sites are deployed and LOCKED. Sessions only file and watch records. Never change contract/, config/ or robot/ unless the artist explicitly asks.

Mainnet

	•	BLACKBOX 0x692EF95A437914e64b686Bf5D0E090328f1c1D4c (verified Etherscan + Sourcify). Image renderer 0xDE5CeC6CB375e70897da024a6B27DD2faE361628.
	•	Owner greencross.eth 0x0DD399a7ED92283e4983C2974FE377070D67f4eB. Registrar (robot ops wallet) 0x02A8018D9312c8b89269Cc3761dC95e7BEC21ab8. Treasury 0x2bCb25A1934D4696A0d733EF8f514095003C6a18.
	•	RPC https://ethereum-rpc.publicnode.com. Mint page https://dithervoid.art/blackbox/ (record link: https://dithervoid.art/blackbox/?rec=N).

Hard rules (never break)

	•	Raw BCBP payloads, PNRs, passenger name and ticket numbers NEVER appear in git, files outside private/, chat replies, commit messages or announcements. decode.py and bb_record.py print none of them; keep it that way.
	•	private/ and source_scans/ are gitignored and never committed. Run python3 machine/gate.py before every commit (pre-commit hook does it). Never bypass with --no-verify.
	•	Never file a pass for a flight not flown. File ONLY at the boarding call, never on a schedule time or a revised estimate.
	•	Always pass an explicit --rec N (next number after the highest records/recNNN in the repo). If a leg is cancelled after registration, bb_record.py --deregister N before anything else.
	•	Quote every filing back to the artist as PERMANENT and wait for an explicit "yes" before committing.
	•	Announcements: route at most. Never flight number, never exact arrival time.
	•	No tokens or keys in files or chat. GitHub auth comes from the session; leave GH_TOKEN/GITHUB_TOKEN unset.
	•	The salt lives only in $BLACKBOX_SALT and private/salt.txt. Never print it.

Pricing (PERMANENT, enforced on chain)

cap = clamp(round-half-up(scheduled block minutes / 60), 1, 13); price = 0.013 + 0.0536 x (13 - cap) / 12 ETH. Deadline = scheduled arrival + 60 min.

Legs on file (schedules only; the pass and the gate are the truth)

Leg	Local date	Route	Sched dep	Sched arr (local)	Deadline (arr + 60)	Block
1	3 Nov	DPS > TPE	15:45 WITA	~21:10 +08:00	2026-11-03T22:10+08:00	~325
2	3 Nov	TPE > LAX	~23:50 +08:00	19:25 PST	2026-11-03T20:25-08:00	~695
3	4 Nov	LAX > MIA	11:04 PST	19:07 EST	2026-11-04T20:07-05:00	303
4	8 Dec	MIA > LAX	13:45 EST	16:37 PST	2026-12-08T17:37-08:00	352
5	8 Dec	LAX > TPE	22:40 PST	~05:30 +08:00 (10 Dec)	2026-12-10T06:30+08:00	~890
6	10 Dec	TPE > DPS	09:10 +08:00	14:35 WITA	2026-12-10T15:35+08:00	~325
Before filing, confirm block minutes and arrival against the airline schedule if the artist gives newer numbers; his numbers win.						

Gate procedure

	1.	Artist sends the pass photo or PDF. Decode: python3 machine/decode.py <file> --year 2026. If no decode: retake guidance, or the DPRT recovery (crop, upscale 2-4x, threshold) built into decode.py. Never retype a barcode.
	2.	python3 machine/bb_record.py --rec N --image <file> --block-minutes M --deadline <ISO with offset> --year 2026 (add --tz for the departure airport if not Bali, e.g. Asia/Taipei, America/Los_Angeles, America/New_York).
	3.	Quote as PERMANENT: REC N, route, block minutes, cap, price ETH, window open, deadline (with UTC). Wait for "yes".
	4.	git add records/recNNN/filing.json only. gate.py must pass. Commit rec NNN: filing and push to main. Verify git ls-remote origin main = HEAD.
	5.	The push triggers the "BLACKBOX robot" workflow; it files on chain and commits records/recNNN/receipt.json with [robot-receipt]. Poll git pull every 60 s for up to 15 min. Then verify on chain via RPC: tx receipt status 1, and records(N).passHash equals filing.json passHash. Report the Etherscan tx link.
	6.	Give the artist tweet text from promo/TWEETS.md template 4 or 5, filled, under 280 chars (links count 23), link https://dithervoid.art/blackbox/?rec=N.
If the robot has not filed within 15 min: check the latest run in the Actions tab via gh run list if available, else ask the artist to run the "BLACKBOX robot" workflow manually (Actions > BLACKBOX robot > Run workflow > main) from the GitHub app.

Landing

The robot lands automatically after the deadline (robot-clock self-dispatch; GitHub cron does not fire here). If the artist lands early he may ask for an empty records/recNNN/LANDED file: commit and push it. After landing, verify landedAt on chain and give template 6 or 7.
