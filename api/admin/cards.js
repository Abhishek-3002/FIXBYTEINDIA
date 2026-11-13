const crypto = require("node:crypto");
const { send, readBody, requireAdmin, supabase, audit, hashToken, makeId } = require("../_lib/common");
module.exports = async function handler(req,res) {
  if (!requireAdmin(req,res)) return;
  try {
    if (req.method === "GET") {
      const cards=await supabase("partner_cards?select=*,medical_stores(store_name,store_code,connection_status)&order=issued_at.desc");
      return send(res,200,{success:true,cards});
    }
    if (req.method === "POST") {
      const b=readBody(req), storeId=String(b.store_id||"");
      if (!storeId) return send(res,400,{success:false,message:"Choose a medical store."});
      const store=(await supabase("medical_stores?select=id,store_name,connection_status&id=eq."+encodeURIComponent(storeId)))[0];
      if (!store) return send(res,404,{success:false,message:"Medical store not found."});
      if (store.connection_status!=="active") return send(res,409,{success:false,message:"Store is Inactive. Activate its CMADD connection before issuing a card."});
      const existing=(await supabase("partner_cards?select=id&store_id=eq."+encodeURIComponent(storeId)))[0];
      if (existing) return send(res,409,{success:false,message:"This store already has a permanent partner card."});
      const earned=(await supabase("partner_rewards?select=id&store_id=eq."+encodeURIComponent(storeId)+"&status=neq.void"))[0];
      if (!earned) return send(res,409,{success:false,message:"No qualifying ₹12,000 reward exists for this store yet."});
      const token=crypto.randomBytes(32).toString("base64url");
      const card=(await supabase("partner_cards",{method:"POST",body:{store_id:storeId,card_code:makeId("FB-CARD"),token_hash:hashToken(token),status:"active"}}))[0];
      await audit("CARD_ISSUED","partner_card",card.id,{card_code:card.card_code,store_id:storeId});
      return send(res,201,{success:true,card,token,verify_url:"/verify.html?token="+encodeURIComponent(token)});
    }
    if (req.method === "PATCH") {
      const b=readBody(req), id=String(b.id||"");
      if (!id) return send(res,400,{success:false,message:"Card ID is required."});
      if (b.rotate_token===true) {
        const token=crypto.randomBytes(32).toString("base64url");
        const card=(await supabase("partner_cards?id=eq."+encodeURIComponent(id),{method:"PATCH",body:{token_hash:hashToken(token),updated_at:new Date().toISOString()}}))[0];
        if (!card) return send(res,404,{success:false,message:"Card not found."});
        await audit("CARD_QR_ROTATED","partner_card",id,{card_code:card.card_code});
        return send(res,200,{success:true,card,token,verify_url:"/verify.html?token="+encodeURIComponent(token)});
      }
      const status=String(b.status||"");
      if (!["active","suspended","revoked"].includes(status)) return send(res,400,{success:false,message:"Valid card status is required."});
      const card=(await supabase("partner_cards?id=eq."+encodeURIComponent(id),{method:"PATCH",body:{status,updated_at:new Date().toISOString()}}))[0];
      if (!card) return send(res,404,{success:false,message:"Card not found."});
      await audit("CARD_STATUS_CHANGED","partner_card",id,{status});
      return send(res,200,{success:true,card});
    }
    return send(res,405,{success:false,message:"Method not allowed."});
  } catch(e) { console.error(e); return send(res,e.status||500,{success:false,message:e.message||"Card request failed."}); }
};
