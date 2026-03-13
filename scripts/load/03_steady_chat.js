// Test 3 — Steady chat load: 2000 connected, 5% talkers (1 msg/s), 95% lurkers (1 msg/60s). E2E.
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { ensureRoomKey, collectWrappedKey, encryptMessage } from './e2e_helper.js';

export const options = {
  stages: [
    { duration: '5m', target: 2000 },
    { duration: '20m', target: 2000 },
    { duration: '2m', target: 0 },
  ],
};

const WS_URL = __ENV.WS_URL;
const ACCESS_CODE = __ENV.ACCESS_CODE;
const INSTANCE_SLUG = __ENV.INSTANCE_SLUG || 'default';
const NL = '\n';
const ROOM = 'general';
const isTalker = __VU % 20 === 0;

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
          for (let i = 0; i < 20 * 60; i++) {
            sleep(1);
            try {
              const key = await ensureRoomKey(state, ACCESS_CODE, INSTANCE_SLUG, ROOM, socket);
              const payload = await encryptMessage(key, 'msg-' + __VU + '-' + i);
              socket.send(payload + NL);
            } catch (_) {}
          }
        } else {
          for (let i = 0; i < 20; i++) {
            sleep(60);
            try {
              const key = await ensureRoomKey(state, ACCESS_CODE, INSTANCE_SLUG, ROOM, socket);
              const payload = await encryptMessage(key, 'lurk-' + __VU + '-' + i);
              socket.send(payload + NL);
            } catch (_) {}
          }
        }
      })();
    });

    socket.setTimeout(function () {
      socket.close();
    }, (20 * 60 + 30) * 1000);
  });
  check(res, { 'ws connected': (r) => r && r.status === 101 });
}
