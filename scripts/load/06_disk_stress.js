// Test 6 — Disk + prune stress: E2E message volume to trigger snapshot and prune.
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { ensureRoomKey, collectWrappedKey, encryptMessage } from './e2e_helper.js';

export const options = {
  stages: [
    { duration: '5m', target: 200 },
    { duration: '45m', target: 200 },
    { duration: '2m', target: 0 },
  ],
};

const WS_URL = __ENV.WS_URL;
const ACCESS_CODE = __ENV.ACCESS_CODE;
const INSTANCE_SLUG = __ENV.INSTANCE_SLUG || 'default';
const NL = '\n';
const ROOM = 'general';
const HOLD_SEC = 45 * 60;
const MSG_INTERVAL_SEC = 5;

export default function () {
  const username = 'loadtest-' + __VU + '-' + __ITER;
  const joinLine = username + ' accesscode:' + ACCESS_CODE + NL;
  const state = { wrappedBlob: null };

  const res = ws.connect(WS_URL, {}, function (socket) {
    socket.on('message', function (msg) {
      collectWrappedKey(state, String(msg), ROOM);
    });

    socket.on('open', function () {
      sleep(0.5);
      socket.send(joinLine);
      sleep(0.5);
      socket.send('/join ' + ROOM + NL);
      sleep(0.5);

      (async function sendLoop() {
        const numMsgs = Math.floor(HOLD_SEC / MSG_INTERVAL_SEC);
        for (let i = 0; i < numMsgs; i++) {
          sleep(MSG_INTERVAL_SEC);
          try {
            const key = await ensureRoomKey(state, ACCESS_CODE, INSTANCE_SLUG, ROOM, socket);
            const payload = await encryptMessage(key, 'disk-' + __VU + '-' + __ITER + '-' + i);
            socket.send(payload + NL);
          } catch (_) {}
        }
      })();
    });

    socket.setTimeout(function () {
      socket.close();
    }, (HOLD_SEC + 60) * 1000);
  });
  check(res, { 'ws connected': (r) => r && r.status === 101 });
}
