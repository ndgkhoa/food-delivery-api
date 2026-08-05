import { check, sleep } from 'k6';
import http from 'k6/http';

const GATEWAY = __ENV.GATEWAY_URL || 'http://localhost:3000';
const KEYCLOAK = __ENV.KEYCLOAK_URL || 'http://localhost:8080';
const KC_USER = __ENV.KC_USER || 'customer-user';
const KC_PASS = __ENV.KC_PASS || 'customer-pass';

const BROWSE_VUS = Number(__ENV.BROWSE_VUS || 15);
const ORDER_RATE = Number(__ENV.ORDER_RATE || 3);
const HOLD = __ENV.HOLD || '40s';

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 499 }));

export const options = {
  scenarios: {
    browse: {
      executor: 'ramping-vus',
      exec: 'browse',
      startVUs: 1,
      stages: [
        { duration: '15s', target: BROWSE_VUS },
        { duration: HOLD, target: BROWSE_VUS },
        { duration: '10s', target: 0 },
      ],
      tags: { scenario: 'browse' },
    },
    order: {
      executor: 'constant-arrival-rate',
      exec: 'order',
      rate: ORDER_RATE,
      timeUnit: '1s',
      duration: HOLD,
      startTime: '15s',
      preAllocatedVUs: Math.max(5, ORDER_RATE * 2),
      maxVUs: Math.max(20, ORDER_RATE * 5),
      tags: { scenario: 'order' },
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    'http_req_duration{scenario:browse}': ['p(95)<500', 'p(99)<1000'],
    'http_req_duration{scenario:order}': ['p(95)<800', 'p(99)<1500'],
    dropped_iterations: ['count<1'],
    checks: ['rate>0.99'],
  },
};

function asArray(res) {
  let body;
  try {
    body = res.json();
  } catch (_e) {
    return [];
  }
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.data)) return body.data;
  if (body && Array.isArray(body.items)) return body.items;
  return [];
}

function idempotencyKey() {
  return `k6-${Date.now()}-${__VU}-${__ITER}-${Math.floor(Math.random() * 1e9)}`;
}

function mintToken() {
  const res = http.post(
    `${KEYCLOAK}/realms/food-delivery/protocol/openid-connect/token`,
    {
      client_id: 'food-delivery-spa',
      username: KC_USER,
      password: KC_PASS,
      grant_type: 'password',
      scope: 'openid',
    },
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      tags: { scenario: 'setup' },
    },
  );
  if (res.status !== 200) {
    throw new Error(`Keycloak token mint failed (${res.status}): ${res.body}`);
  }
  return res.json('access_token');
}

export function setup() {
  const token = mintToken();
  const auth = { headers: { Authorization: `Bearer ${token}` }, tags: { scenario: 'setup' } };

  let orderSeed = null;
  const list = http.get(`${GATEWAY}/api/v1/catalog/restaurants`, auth);
  const restaurants = list.status === 200 ? asArray(list) : [];
  if (restaurants.length > 0 && restaurants[0].id) {
    const rid = restaurants[0].id;
    const items = http.get(`${GATEWAY}/api/v1/catalog/restaurants/${rid}/menu-items`, auth);
    const menu = items.status === 200 ? asArray(items) : [];
    if (menu.length > 0 && menu[0].id) {
      orderSeed = { restaurantId: rid, itemId: menu[0].id };
    }
  }
  return { token, orderSeed };
}

export function browse(data) {
  const auth = {
    headers: { Authorization: `Bearer ${data.token}` },
    tags: { scenario: 'browse' },
  };
  const list = http.get(`${GATEWAY}/api/v1/catalog/restaurants`, auth);
  check(list, { 'browse: restaurants list is 200': (r) => r.status === 200 });

  const restaurants = asArray(list);
  const pick = restaurants[Math.floor(Math.random() * restaurants.length)];
  if (pick?.id) {
    const detail = http.get(`${GATEWAY}/api/v1/catalog/restaurants/${pick.id}`, auth);
    check(detail, { 'browse: restaurant detail is 2xx': (r) => r.status >= 200 && r.status < 300 });
  }
  sleep(1);
}

export function order(data) {
  if (!data.orderSeed) {
    return;
  }
  const res = http.post(
    `${GATEWAY}/api/v1/orders`,
    JSON.stringify({ items: [{ itemId: data.orderSeed.itemId, qty: 1 }] }),
    {
      headers: {
        Authorization: `Bearer ${data.token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey(),
      },
      tags: { scenario: 'order' },
    },
  );
  check(res, { 'order: place order is 2xx': (r) => r.status >= 200 && r.status < 300 });
}
