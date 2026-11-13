const { send, readBody, supabase, hashToken } = require("./_lib/common");
module.exports = async function handler(req,res) {
  if (req.method!=="POST") return send(res,405,{success:false,message:"Method not allowed."});
  const body=readBody(req);
  const token=String(body.token||"");
  if (token.length<30 || token.length>120) return send(res,400,{success:false,verified:false,message:"Invalid verification code."});
  try {
    const hash=hashToken(token);
    const card=(await supabase("partner_cards?select=id,store_id,card_code,status,issued_at,medical_stores(store_name,store_code,connection_status)&token_hash=eq."+encodeURIComponent(hash)))[0];
    if (!card) return send(res,404,{success:false,verified:false,message:"Card not found. Please contact FIXBYTE INDIA."});
    const store=(await supabase("medical_stores?select=id,connection_status&id=eq."+encodeURIComponent(card.store_id)))[0];
    const available=(await supabase("partner_rewards?select=id&store_id=eq."+encodeURIComponent(card.store_id)+"&status=eq.available")).length;
    const verified=card.status==="active" && store?.connection_status==="active";
    await supabase("verification_logs",{method:"POST",body:{card_id:card.id,result:verified?"verified":card.status==="active"?"connection_inactive":"card_"+card.status}}).catch(err=>console.error("Verification log error:",err.message));
    return send(res,200,{success:true,verified,card_code:card.card_code,store_name:card.medical_stores.store_name,card_status:card.status,connection_status:store?.connection_status||"unknown",available_offers:available,website_offer_price:99,checked_at:new Date().toISOString(),message:verified?"Verified Connected Medical Partner":"Card exists, but its current verification status is not active."});
  } catch(e) { console.error(e); return send(res,500,{success:false,message:"Verification service is temporarily unavailable."}); }
};
