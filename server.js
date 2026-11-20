const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const Razorpay = require("razorpay");
require("dotenv").config({ quiet: true });

const { PRODUCTS, findProduct } = require("./products");
const store = require("./db");

const PORT = Number(process.env.PORT) || 4000;
const KEY_ID = process.env.RAZORPAY_KEY_ID || "";
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";
const DEMO_MODE = process.env.DEMO_MODE === "true";

const keysConfigured =
  KEY_ID &&
  KEY_SECRET &&
  !KEY_ID.startsWith("your_") &&
  !KEY_SECRET.startsWith("your_");

const razorpay = keysConfigured
  ? new Razorpay({ key_id: KEY_ID, key_secret: KEY_SECRET })
  : null;

// Demo payments are signed and verified locally; real ones use the Razorpay secret.
const signingSecret = DEMO_MODE ? "razorpay_workshop_demo_secret" : KEY_SECRET;

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

function checkoutMode() {
  if (DEMO_MODE) return "demo";
  if (!razorpay) return "unconfigured";
  return KEY_ID.startsWith("rzp_test_") ? "test" : "live";
}

function normalizeItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { ok: false, message: "Select at least one product." };
  }
  if (rawItems.length > PRODUCTS.length) {
    return { ok: false, message: "Invalid cart." };
  }

  const lines = [];
  const seen = new Set();

  for (const entry of rawItems) {
    const product = findProduct(entry && entry.productId);
    const qty = Number(entry && entry.qty);

    if (!product || !Number.isInteger(qty) || qty < 1 || qty > 10) {
      return { ok: false, message: "Invalid cart item." };
    }
    if (seen.has(product.id)) {
      return { ok: false, message: "Duplicate cart item." };
    }

    seen.add(product.id);
    lines.push({
      id: product.id,
      name: product.name,
      qty,
      unitAmount: product.price
    });
  }

  // Amounts are computed here, never trusted from the browser.
  const total = lines.reduce((sum, line) => sum + line.unitAmount * line.qty, 0);
  if (total < 100 || total > 50000000) {
    return { ok: false, message: "Invalid order amount." };
  }

  return { ok: true, lines, total };
}

function signaturesMatch(expected, provided) {
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(String(provided || ""));
  return (
    expectedBuffer.length === providedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, providedBuffer)
  );
}

function expectedSignature(orderId, paymentId) {
  return crypto
    .createHmac("sha256", signingSecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
}

function toPublicOrder(row) {
  return {
    id: row.razorpay_order_id,
    receipt: row.receipt,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    items: JSON.parse(row.items_json),
    paymentId: row.razorpay_payment_id,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    paidAt: row.paid_at
  };
}

app.get("/config", (req, res) => {
  res.json({
    key: DEMO_MODE ? null : KEY_ID || null,
    demoMode: DEMO_MODE,
    mode: checkoutMode()
  });
});

app.get("/products", (req, res) => {
  res.json({ products: PRODUCTS });
});

app.post("/orders", async (req, res) => {
  const cart = normalizeItems(req.body && req.body.items);
  if (!cart.ok) {
    return res.status(400).json({ message: cart.message });
  }

  if (!razorpay && !DEMO_MODE) {
    return res.status(503).json({
      message:
        "Razorpay keys are not configured. Add test keys to .env or set DEMO_MODE=true."
    });
  }

  const receipt = `rcpt_${Date.now()}`;

  try {
    const order = DEMO_MODE
      ? {
          id: `order_demo_${crypto.randomBytes(8).toString("hex")}`,
          amount: cart.total,
          currency: "INR",
          receipt
        }
      : await razorpay.orders.create({
          amount: cart.total,
          currency: "INR",
          receipt,
          notes: { workshop: "razorpay-workshop" }
        });

    store.createOrder({
      razorpayOrderId: order.id,
      receipt: order.receipt,
      amount: order.amount,
      currency: order.currency,
      items: cart.lines
    });

    res.json({
      id: order.id,
      amount: order.amount,
      currency: order.currency,
      receipt: order.receipt
    });
  } catch (error) {
    console.error("Order creation failed:", error);

    if (error && (error.statusCode === 401 || error.statusCode === 403)) {
      return res.status(401).json({
        message:
          "Razorpay rejected the API keys. Check RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env."
      });
    }

    res.status(500).json({
      message: "Unable to create order. Check your Razorpay keys and try again."
    });
  }
});

app.get("/orders", (req, res) => {
  const ids = String(req.query.ids || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 20);

  res.json({ orders: store.getOrders(ids).map(toPublicOrder) });
});

app.post("/verify-payment", async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
    req.body || {};

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res
      .status(400)
      .json({ success: false, message: "Missing payment details." });
  }

  const order = store.getOrder(razorpay_order_id);
  if (!order) {
    return res
      .status(404)
      .json({ success: false, message: "Order not found." });
  }

  const expected = expectedSignature(razorpay_order_id, razorpay_payment_id);
  if (!signaturesMatch(expected, razorpay_signature)) {
    store.markFailed(razorpay_order_id, "Signature verification failed");
    return res
      .status(400)
      .json({ success: false, message: "Payment verification failed." });
  }

  if (order.status === "paid") {
    if (order.razorpay_payment_id === razorpay_payment_id) {
      return res.json({
        success: true,
        message: "Payment already verified.",
        paymentId: order.razorpay_payment_id
      });
    }
    return res
      .status(409)
      .json({ success: false, message: "This order is already paid." });
  }

  if (razorpay) {
    try {
      const payment = await razorpay.payments.fetch(razorpay_payment_id);
      if (
        payment.order_id !== razorpay_order_id ||
        payment.amount !== order.amount
      ) {
        store.markFailed(
          razorpay_order_id,
          "Payment details did not match the order"
        );
        return res.status(400).json({
          success: false,
          message: "Payment details did not match the order."
        });
      }
      if (!["captured", "authorized"].includes(payment.status)) {
        store.markFailed(razorpay_order_id, `Payment status: ${payment.status}`);
        return res.status(400).json({
          success: false,
          message: "Payment was not completed."
        });
      }
    } catch (error) {
      // Signature already proves the payment belongs to this order.
      console.warn("Could not fetch payment status:", error.message);
    }
  }

  store.markPaid(razorpay_order_id, razorpay_payment_id);
  res.json({
    success: true,
    message: "Payment verified successfully.",
    paymentId: razorpay_payment_id
  });
});

app.post("/payment-failed", (req, res) => {
  const { razorpay_order_id, reason } = req.body || {};
  const order = razorpay_order_id ? store.getOrder(razorpay_order_id) : null;

  if (order && order.status !== "paid") {
    store.markFailed(
      razorpay_order_id,
      String(reason || "Payment failed").slice(0, 300)
    );
  }

  res.json({ ok: true });
});

if (DEMO_MODE) {
  app.post("/demo/payments", (req, res) => {
    const order = store.getOrder((req.body && req.body.orderId) || "");
    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }
    if (order.status === "paid") {
      return res.status(409).json({ message: "Order is already paid." });
    }

    const paymentId = `pay_demo_${crypto.randomBytes(8).toString("hex")}`;
    res.json({
      razorpay_order_id: order.razorpay_order_id,
      razorpay_payment_id: paymentId,
      razorpay_signature: expectedSignature(order.razorpay_order_id, paymentId)
    });
  });
}

app.use((error, req, res, next) => {
  if (error instanceof SyntaxError) {
    return res.status(400).json({ message: "Invalid JSON body." });
  }
  console.error(error);
  res.status(500).json({ message: "Internal server error." });
});

const server = app.listen(PORT, () => {
  console.log(`Razorpay workshop running at http://localhost:${PORT}`);
  if (DEMO_MODE) {
    console.log("Demo mode is on: checkout is simulated, no Razorpay calls are made.");
  } else if (!razorpay) {
    console.warn(
      "Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env, or set DEMO_MODE=true."
    );
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} is already in use. Stop the other server or change PORT in .env.`
    );
    process.exit(1);
  }
  throw error;
});
