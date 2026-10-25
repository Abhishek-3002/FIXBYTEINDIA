// Vercel serverless endpoint for Maya. Secrets must be configured in Vercel Project Settings.
const cors = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (statusCode, body) => ({ statusCode, headers: cors, body: JSON.stringify(body) });
const SYSTEM = `You are Maya, FIXBYTE INDIA's friendly Hindi/Hinglish AI sales assistant. Help visitors choose website plans and qualify leads politely.
Known starting plans: Basic ₹1,499, Business ₹2,999, Premium ₹5,999. Never promise features, delivery dates, hosting, maintenance, discounts or taxes unless confirmed in writing. Admin panel, database, AI integrations and custom features require explicit scope confirmation. Explain that a meeting request is not confirmed until a human replies. Encourage relevant next step without pressure. Contact: call/WhatsApp 7357204736, backup 8000540156, email fixbytesupports@gmail.com.
Ask one useful question at a time to learn business type, website goal, budget, desired features and timeline. If user wants a meeting, tell them to use the Book a Meeting form or offer to capture their contact details in the form. Do not request passwords, OTPs, payment credentials or sensitive data. Reply concisely in the user's language.`;
function safeText(v, max = 2000) { return typeof v === "string" ? v.trim().slice(0, max) : ""; }
async function saveRow(table, row) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return false;
  const r = await fetch(url.replace(/\/$/, "") + "/rest/v1/" + table, {
    method: "POST",
    headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(row)
  });
  if (!r.ok) console.error("Database insert failed", table, r.status, (await r.text()).slice(0, 300));
  return r.ok;
}
module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const body = typeof req.body === "string" ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  const action = safeText(body.action, 30);
  const sessionId = safeText(body.sessionId, 80);
  if (action === "chat") {
    const message = safeText(body.message, 2000);
    if (!message) return res.status(400).json({ error: "Message required" });
    const history = Array.isArray(body.history) ? body.history.slice(-8).map(m => ({
      role: m && m.role === "assistant" ? "assistant" : "user",
      content: safeText(m && m.content, 1200)
    })).filter(m => m.content) : [];
    if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: "Maya AI is not configured yet. Please use WhatsApp or the meeting form." });
    try {
      const response = await fetch(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: "Bearer " + process.env.OPENAI_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-4o-mini", messages: [{ role: "system", content: SYSTEM }, ...history, { role: "user", content: message }], temperature: 0.5, max_tokens: 450 })
      });
      if (!response.ok) {
        console.error("AI provider error", response.status, (await response.text()).slice(0, 400));
        return res.status(502).json({ error: "Maya AI is temporarily unavailable. Please try again or contact FIXBYTE on WhatsApp." });
      }
      const data = await response.json();
      const reply = safeText(data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content, 4000);
      if (!reply) return res.status(502).json({ error: "Maya could not prepare a reply. Please try again." });
      await saveRow("maya_conversations", { session_id: sessionId || null, user_message: message, assistant_message: reply, page_path: safeText(body.pagePath, 200) || "/" });
      return res.status(200).json({ reply });
    } catch (err) {
      console.error("Maya chat error", String(err).slice(0, 300));
      return res.status(500).json({ error: "Maya encountered an error. Please try again." });
    }
  }
  if (action === "lead" || action === "meeting") {
    const lead = body.lead && typeof body.lead === "object" ? body.lead : {};
    const row = {
      meeting_id: safeText(lead.meetingId, 60) || null,
      full_name: safeText(lead.name, 120),
      phone: safeText(lead.phone, 40),
      email: safeText(lead.email, 180) || null,
      business_name: safeText(lead.business, 160) || null,
      plan: safeText(lead.plan, 100) || null,
      budget: safeText(lead.budget, 100) || null,
      website_type: safeText(lead.websiteType, 100) || null,
      features: safeText(lead.features, 1500) || null,
      timeline: safeText(lead.timeline, 100) || null,
      meeting_type: safeText(lead.meetingType, 60) || null,
      meeting_date: safeText(lead.date, 20) || null,
      meeting_time: safeText(lead.time, 20) || null,
      requirements: safeText(lead.requirements, 2500) || null,
      source: action === "meeting" ? "meeting_form" : "maya_chat",
      status: "new"
    };
    if (!row.full_name || !row.phone) return res.status(400).json({ error: "Name and phone are required." });
    const saved = await saveRow("maya_leads", row);
    return res.status(200).json({ saved, message: saved ? "Lead saved" : "Database not configured; use WhatsApp to send this enquiry." });
  }
  return res.status(400).json({ error: "Unsupported action" });
};
