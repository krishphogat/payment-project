const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const db = new DatabaseSync(path.join(__dirname, "orders.sqlite"));

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    razorpay_order_id TEXT NOT NULL UNIQUE,
    receipt TEXT NOT NULL,
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL,
    items_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'created',
    razorpay_payment_id TEXT,
    failure_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    paid_at TEXT
  );

  CREATE INDEX IF NOT EXISTS orders_created_at ON orders (created_at DESC);
`);

function now() {
  return new Date().toISOString();
}

function createOrder({ razorpayOrderId, receipt, amount, currency, items }) {
  db.prepare(`
    INSERT INTO orders
      (razorpay_order_id, receipt, amount, currency, items_json, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'created', ?, ?)
  `).run(razorpayOrderId, receipt, amount, currency, JSON.stringify(items), now(), now());
}

function getOrder(razorpayOrderId) {
  return db.prepare("SELECT * FROM orders WHERE razorpay_order_id = ?").get(razorpayOrderId);
}

function getOrders(razorpayOrderIds) {
  if (razorpayOrderIds.length === 0) return [];
  const placeholders = razorpayOrderIds.map(() => "?").join(", ");
  return db
    .prepare(`SELECT * FROM orders WHERE razorpay_order_id IN (${placeholders}) ORDER BY created_at DESC`)
    .all(...razorpayOrderIds);
}

function markPaid(razorpayOrderId, paymentId) {
  db.prepare(`
    UPDATE orders
    SET status = 'paid', razorpay_payment_id = ?, failure_reason = NULL, paid_at = ?, updated_at = ?
    WHERE razorpay_order_id = ?
  `).run(paymentId, now(), now(), razorpayOrderId);
}

function markFailed(razorpayOrderId, reason) {
  db.prepare(`
    UPDATE orders
    SET status = 'failed', failure_reason = ?, updated_at = ?
    WHERE razorpay_order_id = ? AND status != 'paid'
  `).run(reason, now(), razorpayOrderId);
}

module.exports = { createOrder, getOrder, getOrders, markPaid, markFailed };
