const crypto = require("node:crypto");
const PLAN_PRICES = { basic: 1499, business: 2999, premium: 5999, jet: 9999 };

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    return res.status(503).json({ verified: false, error: "Razorpay server credentials are not configured." });
  }

  try {
    const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature, planId, paymentMode } = req.body || {};
    if (![orderId, paymentId, signature].every(v => typeof v === "string" && v.length > 0)) {
      return res.status(400).json({ verified: false, error: "Missing payment verification fields." });
    }
    if (!Object.prototype.hasOwnProperty.call(PLAN_PRICES, planId) || !["advance", "full"].includes(paymentMode)) {
      return res.status(400).json({ verified: false, error: "Invalid plan or payment option." });
    }

    const expectedSignature = crypto
      .createHmac("sha256", keySecret)
      .update(orderId + "|" + paymentId)
      .digest("hex");
    const supplied = Buffer.from(signature, "utf8");
    const expected = Buffer.from(expectedSignature, "utf8");
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
      return res.status(400).json({ verified: false, error: "Payment signature could not be verified. Do not retry payment until the team checks the payment status." });
    }

    const auth = Buffer.from(keyId + ":" + keySecret).toString("base64");
    const response = await fetch("https://api.razorpay.com/v1/payments/" + encodeURIComponent(paymentId), {
      headers: { Authorization: "Basic " + auth }
    });
    const payment = await response.json();
    if (!response.ok || !payment.id) {
      console.error("Razorpay payment lookup failed:", payment?.error?.code || response.status);
      return res.status(502).json({ verified: false, error: "Could not confirm payment status with Razorpay. Please contact FIXBYTE INDIA before paying again." });
    }

    const baseRupees = PLAN_PRICES[planId];
    const expectedAmount = (paymentMode === "advance" ? Math.round(baseRupees / 2) : baseRupees) * 100;
    if (payment.order_id !== orderId || payment.amount !== expectedAmount || payment.currency !== "INR") {
      return res.status(400).json({ verified: false, error: "Payment details do not match this plan. FIXBYTE INDIA must review this payment." });
    }
    if (payment.status !== "captured") {
      return res.status(409).json({
        verified: false,
        error: payment.status === "authorized"
          ? "Payment is authorized but not captured yet. Please do not pay again; contact FIXBYTE INDIA."
          : "Razorpay payment status is " + String(payment.status || "unknown") + ". Please contact FIXBYTE INDIA before retrying."
      });
    }

    return res.status(200).json({
      verified: true,
      paymentId: payment.id,
      orderId: payment.order_id,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status
    });
  } catch (error) {
    console.error("Verify payment error:", error?.message || "Unknown error");
    return res.status(500).json({ verified: false, error: "Payment verification failed unexpectedly. Please contact FIXBYTE INDIA." });
  }
};
