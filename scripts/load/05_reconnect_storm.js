// Test 5 — Reconnect storm: steady load with short-lived connections; each sends one E2E message then disconnects.
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { ensureRoomKey, collectWrappedKey, encryptMessage } from './e2e_helper.js';

export const options = {
  stages: [
    { duration: '2m', target: 500 },
    { duration: '5m', target: 500 },
    { duration: '1m', target: 600 },
    { duration: '2m', target: 600 },
    { duration: '1m', target: 0 },
  ],
};

const WS_URL = __ENV.WS_URL;
const ACCESS_CODE = __ENV.ACCESS_CODE;
const INSTANCE_SLUG = __ENV.INSTANCE_SLUG || 'default';
const NL = '\n';
const ROOM = 'general';

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

      (async function sendOne() {
        try {
          const key = await ensureRoomKey(state, ACCESS_CODE, INSTANCE_SLUG, ROOM, socket);
          const payload = await encryptMessage(key, 'churn-' + __VU + '-' + __ITER);
          socket.send(payload + NL);
        } catch (_) {}
      })();

      sleep(5 + Math.random() * 10);
      sleep(2);
    });

    socket.setTimeout(function () {
      socket.close();
    }, 30000);
  });
  check(res, { 'ws connected': (r) => r && r.status === 101 });
}
