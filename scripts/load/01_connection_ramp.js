// Test 1 — Connection ramp (pure WS scale): ramp 0→1000 over 10 min, hold 10 min, minimal traffic.
import ws from 'k6/ws';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '10m', target: 1000 },
    { duration: '10m', target: 1000 },
    { duration: '2m', target: 0 },
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
      // One heartbeat per minute to keep connection alive; no chat.
      for (let i = 0; i < 11; i++) {
        sleep(60);
        socket.send('/heartbeat' + NL);
      }
    });

    socket.on('message', function (msg) {});

    socket.setTimeout(function () {
      socket.close();
    }, (10 * 60 + 30) * 1000);
  });
  check(res, { 'ws connected': (r) => r && r.status === 101 });
}
