# Load tests (k6) for the-bar

Stress tests for the WebSocket server, run against your deployment using Docker and k6.

## Prerequisites

- Docker running.
- Target server URL and access code (set `WS_URL` and `ACCESS_CODE` in `.env`).

## Environment variables

Set these in your local `.env` (see project root `.env.example`); **do not hardcode URLs or access codes in scripts or commit them**. The k6 scripts read `WS_URL` and `ACCESS_CODE` from the environment.

| Variable     | Required | Description |
|--------------|----------|-------------|
| `WS_URL`     | Yes      | Full WebSocket URL including path (e.g. `wss://your-server.example.com/bar/ws`). Add to `.env` for load tests. |
| `ACCESS_CODE`| Yes      | Server access code (must match the server’s `ACCESS_CODE`). Same as server config; set in `.env`. |

Optional: add others (e.g. `INSTANCE_SLUG`) if you extend the scripts.

## Run from project root

All commands assume you are in the repository root. Use `--env-file .env` so Docker passes your local `.env` (with `WS_URL` and `ACCESS_CODE`) into the container; **never commit `.env`**.

### Run a single script (stdin)

```bash
docker run -i --rm --env-file .env \
  grafana/k6 run - < scripts/load/00_baseline.js
```

### Run with volume mount (any script)

```bash
docker run -i --rm --env-file .env \
  -v "$(pwd)/scripts/load:/scripts" \
  -w /scripts \
  grafana/k6 run 00_baseline.js
```

Replace `00_baseline.js` with `01_connection_ramp.js`, `02_handshake_spike.js`, etc.

## Test order and what each does

Run in order. Capture server logs and your host's metrics during each run.

| Script               | Purpose |
|----------------------|--------|
| `00_baseline.js`     | **Test 0** — Sanity: 10 VUs, join + `/join general`, 1 msg every 10s, hold 5 min. |
| `01_connection_ramp.js` | **Test 1** — WS scale: ramp 0→1000 over 10 min, hold 10 min, minimal traffic (heartbeat/min). |
| `02_handshake_spike.js` | **Test 2** — Handshake spike: 0→1000 in 60s, hold 2 min, then ramp down. |
| `03_steady_chat.js`  | **Test 3** — Steady chat: 2000 VUs, 5% talkers (1 msg/s), 95% lurkers (1 msg/60s), 20 min hold. |
| `04_fanout.js`       | **Test 4** — Fan-out: 1000 in one room, 50 talkers at 2 msg/s for 60s bursts. |
| `05_reconnect_storm.js` | **Test 5** — Reconnect churn: 500 VUs with short sessions; then 600 for a spike. |
| `06_disk_stress.js`  | **Test 6** — Disk/prune: 200 VUs, msg every 5s for 45 min to trigger snapshot/prune. |
| `07_slowmode_rate_limit.js` | **Test 7** — Slowmode/rate limit: 20 VUs send bursts; expect `slowmode:N` or "Rate limited" from server. **Requires** `SLOWMODE_SECONDS` and/or `RATE_LIMIT_PER_SEC` set on the server (e.g. `SLOWMODE_SECONDS=2` `RATE_LIMIT_PER_SEC=2`). |

## Where to look for results

- **k6:** Summary and metrics in the terminal (checks, iteration duration, ws_connecting, ws_session_duration, etc.).
- **Server:** Stdout logs. Look for `[loadstats]` lines (conns_current, msgs_in, msgs_out, skipped_channel_full, snapshot_*, prune_*), plus "Snapshot created", "Pruned …".
- **Your host:** Service metrics (CPU, RAM, network) in your provider's dashboard.

**Log rate limits (e.g. Railway):** Under heavy load (e.g. Test 4 fan-out), the server can log many "Broadcasting to..." and "Skipped … (channel full)" lines and hit platform rate limits. Set **`REDUCE_LOG_RATE=1`** on the server so it does not log each of those lines; `[loadstats]` still prints every 10s with `skipped_channel_full` and other counts.

## Protocol notes

- First line from client must be: `username accesscode:ACCESS_CODE\n` (username unique per connection; use `loadtest-${__VU}-${__ITER}` in scripts).
- Default room is `general`; send `/join general\n` after join.
- Chat = plain text line (no JSON). Keepalive: `/heartbeat\n` every ~30s if holding long.
