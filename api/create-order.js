const PLAN_PRICES = { basic: 1499, business: 2999, premium: 5999 };
const PLAN_NAMES = { basic: "Basic Website", business: "Business Website", premium: "Premium Website" };

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    return res.status(503).json({
      error: "Online payment is not configured yet. FIXBYTE INDIA must add Razorpay Key ID and Key Secret in Vercel Environment Variables."
    });
  }

  try {
    const { planId, paymentMode, customer } = req.body || {};
    if (!Object.prototype.hasOwnProperty.call(PLAN_PRICES, planId)) {
      return res.status(400).json({ error: "Please select a valid fixed-price plan." });
    }
    if (!["advance", "full"].includes(paymentMode)) {
      return res.status(400).json({ error: "Choose full payment or 50% advance." });
    }

    const priceRupees = PLAN_PRICES[planId];
    const payableRupees = paymentMode === "advance" ? Math.round(priceRupees / 2) : priceRupees;
    const amount = payableRupees * 100;
    const safeName = String(customer?.name || "").trim().slice(0, 100);
    const safeEmail = String(customer?.email || "").trim().slice(0, 160);
    const safePhone = String(customer?.phone || "").trim().slice(0, 24);
    if (!safeName || !safeEmail || !safePhone) {
      return res.status(400).json({ error: "Please fill in your name, email and mobile number." });
    }

    const auth = Buffer.from(keyId + ":" + keySecret).toString("base64");
    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: "Basic " + auth,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        amount,
        currency: "INR",
        receipt: ("fb_" + Date.now()).slice(0, 40),
        notes: {
          plan_id: planId,
          plan_name: PLAN_NAMES[planId],
          payment_mode: paymentMode,
          customer_name: safeName,
          customer_email: safeEmail,
          customer_phone: safePhone
        }
      })
    });

    const data = await response.json();
    if (!response.ok || !data.id) {
      console.error("Razorpay order creation failed:", data?.error?.code || response.status);
      return res.status(502).json({ error: "Razorpay could not create the order. Please try again or contact FIXBYTE INDIA." });
    }

    return res.status(200).json({
      orderId: data.id,
      keyId,
      amount: data.amount,
      currency: data.currency,
      planId,
      planName: PLAN_NAMES[planId],
      paymentMode,
      description: PLAN_NAMES[planId] + (paymentMode === "advance" ? " — 50% advance" : " — full payment")
    });
  } catch (error) {
    console.error("Create order error:", error?.message || "Unknown error");
    return res.status(500).json({ error: "Unable to start payment securely. Please try again." });
  }
};
