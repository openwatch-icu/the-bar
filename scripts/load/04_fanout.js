// Test 4 — Fan-out: 1000 in one room, 50 talkers at 2 msg/s for 60s bursts. E2E.
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { ensureRoomKey, collectWrappedKey, encryptMessage } from './e2e_helper.js';

export const options = {
  stages: [
    { duration: '3m', target: 1000 },
    { duration: '2m', target: 1000 },
    { duration: '1m', target: 0 },
  ],
};

const WS_URL = __ENV.WS_URL;
const ACCESS_CODE = __ENV.ACCESS_CODE;
const INSTANCE_SLUG = __ENV.INSTANCE_SLUG || 'default';
const NL = '\n';
const ROOM = 'general';
const isTalker = __VU <= 50;

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
        if (isTalker) {
          for (let i = 0; i < 120; i++) {
            sleep(0.5);
            try {
              const key = await ensureRoomKey(state, ACCESS_CODE, INSTANCE_SLUG, ROOM, socket);
              const payload = await encryptMessage(key, 'burst-' + __VU + '-' + i);
              socket.send(payload + NL);
            } catch (_) {}
          }
        } else {
          sleep(60 * 2 + 10);
        }
      })();
    });

    socket.setTimeout(function () {
      socket.close();
    }, (2 * 60 + 30) * 1000);
  });
  check(res, { 'ws connected': (r) => r && r.status === 101 });
}
