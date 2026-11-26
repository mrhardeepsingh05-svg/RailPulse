// Controlled k6 load test script for local/staging RailPulse AI verification.
// Never run against live operational railway systems.
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '10s', target: 10 },
    { duration: '20s', target: 20 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<250'],
  },
};

const BASE_URL = __ENV.RAILPULSE_URL || 'http://127.0.0.1:8000';

export function setup() {
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ username: 'admin.demo', password: 'Admin@2026!' }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  return { token: res.json('access_token') };
}

export default function (data) {
  const headers = { Authorization: `Bearer ${data.token}` };
  const health = http.get(`${BASE_URL}/api/health`);
  check(health, { 'health 200': (r) => r.status === 200 });

  const dash = http.get(`${BASE_URL}/api/dashboard`, { headers });
  check(dash, { 'dashboard 200': (r) => r.status === 200 });

  const assets = http.get(`${BASE_URL}/api/assets`, { headers });
  check(assets, { 'assets 200': (r) => r.status === 200 });

  sleep(0.2);
}
