const STORAGE_KEY = "razorpay_workshop_order_ids";
const MAX_QTY = 10;

const state = {
  products: [],
  quantities: new Map(),
  config: { demoMode: false, key: null, mode: "demo" },
  busy: false,
  demoOrder: null
};

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0
});

const els = {
  productGrid: document.getElementById("product-grid"),
  cartLines: document.getElementById("cart-lines"),
  total: document.getElementById("total"),
  payButton: document.getElementById("pay-button"),
  status: document.getElementById("checkout-status"),
  modeBadge: document.getElementById("mode-badge"),
  historyBody: document.getElementById("history-body"),
  historyTable: document.getElementById("history-table"),
  historyEmpty: document.getElementById("history-empty"),
  modal: document.getElementById("demo-modal"),
  demoAmount: document.getElementById("demo-amount")
};

const STATUS_LABELS = {
  created: "Awaiting payment",
  paid: "Paid",
  failed: "Failed"
};

init();

async function init() {
  bindEvents();

  try {
    const [config, productData] = await Promise.all([
      requestJson("/config"),
      requestJson("/products")
    ]);
    state.config = config;
    state.products = Array.isArray(productData.products) ? productData.products : [];
    if (state.products.length === 0) {
      throw new Error("The server returned no products.");
    }
  } catch (error) {
    setStatus(error.message, true);
    return;
  }

  renderMode();
  renderProducts();
  renderCart();
  loadHistory();
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function setStatus(message, isError) {
  els.status.textContent = message;
  els.status.classList.toggle("error", Boolean(isError));
}

function setBusy(busy) {
  state.busy = busy;
  els.payButton.disabled = busy || cartLines().length === 0;
  els.payButton.textContent = busy ? "Opening checkout…" : "Pay now";
}

async function requestJson(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    throw new Error(
      "Could not reach the server. Make sure npm run dev is running, then reload this page."
    );
  }

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      data = null;
    }
  }

  if (!response.ok) {
    throw new Error(
      (data && data.message) || `The server returned HTTP ${response.status}.`
    );
  }
  if (data === null) {
    throw new Error(
      "The server returned an empty response. Check that the right server is running, then reload."
    );
  }

  return data;
}

function renderMode() {
  const modes = {
    demo: ["Demo checkout", "badge demo"],
    test: ["Razorpay test mode", "badge test"],
    live: ["Live mode", "badge live"],
    unconfigured: ["Keys not configured", "badge live"]
  };
  const [label, className] = modes[state.config.mode] || modes.unconfigured;
  els.modeBadge.textContent = label;
  els.modeBadge.className = className;
}

function renderProducts() {
  els.productGrid.replaceChildren();

  for (const product of state.products) {
    const card = el("article", "product");
    card.dataset.productId = product.id;

    const head = el("div");
    head.append(
      el("h3", null, product.name),
      el("p", "product-copy", product.description)
    );

    const foot = el("div", "product-foot");
    foot.append(el("span", "price", inr.format(product.price / 100)));

    const stepper = el("div", "stepper");

    const decrease = el("button", "step-btn", "−");
    decrease.type = "button";
    decrease.dataset.action = "dec";
    decrease.dataset.id = product.id;
    decrease.setAttribute("aria-label", `Remove one ${product.name}`);

    const quantity = el("span", "qty", "0");
    quantity.dataset.qtyFor = product.id;

    const increase = el("button", "step-btn", "+");
    increase.type = "button";
    increase.dataset.action = "inc";
    increase.dataset.id = product.id;
    increase.setAttribute("aria-label", `Add one ${product.name}`);

    stepper.append(decrease, quantity, increase);
    foot.append(stepper);
    card.append(head, foot);
    els.productGrid.append(card);
  }
}

function cartLines() {
  const lines = [];
  for (const product of state.products) {
    const qty = state.quantities.get(product.id) || 0;
    if (qty > 0) lines.push({ product, qty });
  }
  return lines;
}

function cartTotal() {
  return cartLines().reduce(
    (sum, line) => sum + line.product.price * line.qty,
    0
  );
}

function renderCart() {
  els.productGrid.querySelectorAll(".product").forEach((card) => {
    const qty = state.quantities.get(card.dataset.productId) || 0;
    card.classList.toggle("selected", qty > 0);
  });

  els.productGrid.querySelectorAll("[data-qty-for]").forEach((node) => {
    node.textContent = String(state.quantities.get(node.dataset.qtyFor) || 0);
  });

  els.productGrid.querySelectorAll('[data-action="dec"]').forEach((button) => {
    button.disabled = (state.quantities.get(button.dataset.id) || 0) === 0;
  });

  els.productGrid.querySelectorAll('[data-action="inc"]').forEach((button) => {
    button.disabled = (state.quantities.get(button.dataset.id) || 0) >= MAX_QTY;
  });

  els.cartLines.replaceChildren();
  const lines = cartLines();

  if (lines.length === 0) {
    els.cartLines.append(
      el("li", "empty", "Your cart is empty. Add a pass to continue.")
    );
  } else {
    for (const { product, qty } of lines) {
      const row = el("li");
      row.append(
        el("span", "cart-name", `${product.name} × ${qty}`),
        el("span", "cart-amount", inr.format((product.price * qty) / 100))
      );
      els.cartLines.append(row);
    }
  }

  els.total.textContent = inr.format(cartTotal() / 100);
  els.payButton.disabled = state.busy || lines.length === 0;
}

function bindEvents() {
  els.productGrid.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const { id, action } = button.dataset;
    const current = state.quantities.get(id) || 0;
    const next =
      action === "inc" ? Math.min(current + 1, MAX_QTY) : Math.max(current - 1, 0);

    if (next === 0) state.quantities.delete(id);
    else state.quantities.set(id, next);

    setStatus("");
    renderCart();
  });

  els.payButton.addEventListener("click", payNow);
  document.getElementById("refresh-history").addEventListener("click", loadHistory);

  document.getElementById("demo-success").addEventListener("click", () => {
    demoOutcome("success");
  });
  document.getElementById("demo-failure").addEventListener("click", () => {
    demoOutcome("failure");
  });
  document.getElementById("demo-cancel").addEventListener("click", () => {
    closeDemoModal();
    setStatus("Demo checkout cancelled.");
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.modal.classList.contains("hidden")) {
      closeDemoModal();
      setStatus("Demo checkout cancelled.");
    }
  });
}

async function payNow() {
  const lines = cartLines();
  if (lines.length === 0 || state.busy) return;

  setBusy(true);
  setStatus("Creating your order…");

  try {
    const order = await requestJson("/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: lines.map((line) => ({
          productId: line.product.id,
          qty: line.qty
        }))
      })
    });

    rememberOrder(order.id);
    setStatus("Opening checkout…");

    if (state.config.demoMode) openDemoCheckout(order);
    else openRazorpayCheckout(order);
  } catch (error) {
    setStatus(error.message, true);
    setBusy(false);
  }
}

function openRazorpayCheckout(order) {
  if (typeof Razorpay === "undefined") {
    setStatus("Could not load Razorpay Checkout. Check your internet connection.", true);
    setBusy(false);
    return;
  }

  const checkout = new Razorpay({
    key: state.config.key,
    amount: order.amount,
    currency: order.currency,
    name: "Ramanujan Pvt. Ltd.",
    description: `Workshop pass · ${order.receipt}`,
    order_id: order.id,
    theme: { color: "#4f46e5" },
    handler: (payment) => verifyPayment(payment),
    modal: {
      ondismiss: () => {
        setBusy(false);
        setStatus("Checkout closed before payment.");
        loadHistory();
      }
    }
  });

  checkout.on("payment.failed", (response) => {
    const reason = (response && response.error && response.error.description) ||
      "The payment could not be completed.";
    reportFailure(order.id, reason).finally(() => {
      window.location.href = `/failure.html?order=${encodeURIComponent(order.id)}&reason=${encodeURIComponent(reason)}`;
    });
  });

  checkout.open();
}

function openDemoCheckout(order) {
  state.demoOrder = order;
  els.demoAmount.textContent = `${inr.format(order.amount / 100)} · ${order.id}`;
  els.modal.classList.remove("hidden");
  document.getElementById("demo-success").focus();
}

function closeDemoModal() {
  state.demoOrder = null;
  els.modal.classList.add("hidden");
}

async function demoOutcome(outcome) {
  const order = state.demoOrder;
  if (!order) return;

  if (outcome === "failure") {
    const reason = "The payment was declined in the demo checkout.";
    await reportFailure(order.id, reason);
    window.location.href = `/failure.html?order=${encodeURIComponent(order.id)}&reason=${encodeURIComponent(reason)}`;
    return;
  }

  setStatus("Confirming demo payment…");

  try {
    const payment = await requestJson("/demo/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: order.id })
    });

    closeDemoModal();
    await verifyPayment(payment);
  } catch (error) {
    closeDemoModal();
    setStatus(error.message, true);
    setBusy(false);
  }
}

async function verifyPayment(payment) {
  setStatus("Verifying payment with the server…");
  const orderId = encodeURIComponent(payment.razorpay_order_id);

  try {
    const result = await requestJson("/verify-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payment)
    });

    if (result.success) {
      window.location.href = `/success.html?order=${orderId}`;
    } else {
      window.location.href = `/failure.html?order=${orderId}&reason=${encodeURIComponent(result.message || "Verification failed.")}`;
    }
  } catch (error) {
    window.location.href = `/failure.html?order=${orderId}&reason=${encodeURIComponent(error.message)}`;
  }
}

async function reportFailure(orderId, reason) {
  try {
    await fetch("/payment-failed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ razorpay_order_id: orderId, reason })
    });
    rememberOrder(orderId);
  } catch (error) {
    // The failure page still works without this bookkeeping call.
  }
}

function readOrderIds() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch (error) {
    return [];
  }
}

function rememberOrder(orderId) {
  const ids = readOrderIds().filter((id) => id !== orderId);
  ids.unshift(orderId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids.slice(0, 15)));
}

async function loadHistory() {
  const ids = readOrderIds();
  if (ids.length === 0) {
    renderHistory([]);
    return;
  }

  try {
    const data = await requestJson(`/orders?ids=${encodeURIComponent(ids.join(","))}`);
    renderHistory(Array.isArray(data.orders) ? data.orders : []);
  } catch (error) {
    els.historyBody.replaceChildren();
    els.historyTable.classList.add("hidden");
    els.historyEmpty.textContent = `Could not load transactions: ${error.message}`;
    els.historyEmpty.classList.remove("hidden");
  }
}

function renderHistory(orders) {
  els.historyBody.replaceChildren();

  for (const order of orders) {
    const row = document.createElement("tr");

    const orderCell = document.createElement("td");
    const code = el("span", "order-code", order.id);
    code.title = order.id;
    orderCell.append(code);

    const dateCell = el("td", null, formatDate(order.createdAt));
    const amountCell = el("td", "amount-cell", inr.format(order.amount / 100));

    const statusCell = document.createElement("td");
    const chip = el(
      "span",
      `chip ${order.status}`,
      STATUS_LABELS[order.status] || order.status
    );
    if (order.failureReason) chip.title = order.failureReason;
    statusCell.append(chip);

    row.append(orderCell, dateCell, amountCell, statusCell);
    els.historyBody.append(row);
  }

  const hasRows = orders.length > 0;
  els.historyTable.classList.toggle("hidden", !hasRows);
  els.historyEmpty.classList.toggle("hidden", hasRows);
  els.historyEmpty.textContent = "No transactions yet. Your first paid order will appear here.";
}

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}
