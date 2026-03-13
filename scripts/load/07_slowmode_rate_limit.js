// Test 7 — Slowmode and rate limiting: send at high rate; expect slowmode:N or "Rate limited" from server.
// Server must have SLOWMODE_SECONDS and/or RATE_LIMIT_PER_SEC set (e.g. SLOWMODE_SECONDS=2, RATE_LIMIT_PER_SEC=2).
import ws from 'k6/ws';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '1m', target: 20 },
    { duration: '30s', target: 0 },
  ],
};

const WS_URL = __ENV.WS_URL;
const ACCESS_CODE = __ENV.ACCESS_CODE;
const NL = '\n';

export default function () {
  const username = 'loadtest-' + __VU + '-' + __ITER;
  const joinLine = username + ' accesscode:' + ACCESS_CODE + NL;

  let gotSlowmodeOrRateLimit = false;
  const res = ws.connect(WS_URL, {}, function (socket) {
    socket.on('open', function () {
      sleep(0.5);
      socket.send(joinLine);
      sleep(1);
      socket.send('/join general' + NL);
      sleep(0.5);
      // Send many messages quickly to trigger slowmode or rate limit
      for (let i = 0; i < 15; i++) {
        socket.send('stress-' + __VU + '-' + i + NL);
      }
    });

    socket.on('message', function (msg) {
      const s = typeof msg === 'string' ? msg : msg;
      if (s.includes('slowmode:') || s.includes('Rate limited')) {
        gotSlowmodeOrRateLimit = true;
      }
    });

    socket.setTimeout(function () {
      socket.close();
    }, 15 * 1000);
  });

  check(res, { 'ws connected': (r) => r && r.status === 101 });
  sleep(3); // allow server slowmode/rate-limit responses to arrive
  check(gotSlowmodeOrRateLimit, { 'received slowmode or rate limit': (v) => v === true });
}
