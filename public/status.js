const params = new URLSearchParams(window.location.search);
const orderId = (params.get("order") || "").trim();
const reason = (params.get("reason") || "").trim();
const page = document.body.dataset.page;

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0
});

const els = {
  order: document.getElementById("fact-order"),
  amount: document.getElementById("fact-amount"),
  payment: document.getElementById("fact-payment"),
  date: document.getElementById("fact-date"),
  reason: document.getElementById("status-reason"),
  note: document.getElementById("status-note")
};

if (page === "success") loadOrder();
else initFailure();

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function showNote(message) {
  if (!els.note) return;
  els.note.textContent = message;
  els.note.classList.remove("hidden");
}

async function fetchOrder(id) {
  const response = await fetch(`/orders?ids=${encodeURIComponent(id)}`);
  const text = await response.text();
  if (!response.ok || !text) return null;
  const data = JSON.parse(text);
  return (data.orders || [])[0];
}

function fillFacts(order) {
  els.order.textContent = order.id;
  els.amount.textContent = inr.format(order.amount / 100);
  if (els.payment) els.payment.textContent = order.paymentId || "—";
  els.date.textContent = formatDate(order.paidAt || order.createdAt);
}

async function loadOrder() {
  if (!orderId) {
    showNote("No order id was provided, so this payment cannot be looked up.");
    return;
  }

  try {
    const order = await fetchOrder(orderId);
    if (!order) {
      els.order.textContent = orderId;
      showNote("We could not find this order on the server.");
      return;
    }

    fillFacts(order);

    if (order.status !== "paid") {
      showNote("This order is not confirmed as paid yet. If you just finished checkout, refresh in a moment.");
    }
  } catch (error) {
    els.order.textContent = orderId;
    showNote("Could not reach the server to confirm this order. Make sure it is running, then reload.");
  }
}

async function initFailure() {
  els.reason.textContent =
    reason || "The payment could not be completed. No money was deducted for a failed attempt.";

  if (!orderId) return;
  els.order.textContent = orderId;

  try {
    const order = await fetchOrder(orderId);
    if (order) {
      fillFacts(order);
      if (order.status === "paid") {
        showNote("This order is actually marked as paid. Open the store to review the transaction.");
      }
    }
  } catch (error) {
    // The order id from the URL is still shown above.
  }
}
