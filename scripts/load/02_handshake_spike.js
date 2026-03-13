// Test 2 — Login/handshake spike: 0→1000 in 60s, hold 2 min, then disconnect all.
import ws from 'k6/ws';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '1m', target: 1000 },
    { duration: '2m', target: 1000 },
    { duration: '30s', target: 0 },
  ],
};

const WS_URL = __ENV.WS_URL;
const ACCESS_CODE = __ENV.ACCESS_CODE;
const NL = '\n';

export default function () {
  const username = 'loadtest-' + __VU + '-' + __ITER;
  const joinLine = username + ' accesscode:' + ACCESS_CODE + NL;

  const res = ws.connect(WS_URL, {}, function (socket) {
    socket.on('open', function () {
      sleep(0.5);
      socket.send(joinLine);
      sleep(0.5);
      socket.send('/join general' + NL);
    });

    socket.on('message', function (msg) {});

    socket.setTimeout(function () {
      socket.close();
    }, (2 * 60 + 15) * 1000);
  });
  check(res, { 'ws connected': (r) => r && r.status === 101 });
}
