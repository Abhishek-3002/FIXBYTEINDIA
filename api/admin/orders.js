const { send, readBody, requireAdmin, supabase, audit } = require("../_lib/common");
module.exports = async function handler(req,res) {
  if (!requireAdmin(req,res)) return;
  try {
    if (req.method==="GET") {
      const orders=await supabase("website_orders?select=*,medical_stores(store_name,owner_name,mobile),partner_rewards(reward_code,status)&order=created_at.desc");
      return send(res,200,{success:true,orders});
    }
    if (req.method==="POST") {
      const b=readBody(req), rewardId=String(b.reward_id||"");
      if (!rewardId) return send(res,400,{success:false,message:"Select an available website reward."});
      const reward=(await supabase("partner_rewards?select=*&id=eq."+encodeURIComponent(rewardId)))[0];
      if (!reward || reward.status!=="available") return send(res,409,{success:false,message:"This reward is not available."});
      const store=(await supabase("medical_stores?select=id,connection_status&id=eq."+encodeURIComponent(reward.store_id)))[0];
      if (!store || store.connection_status!=="active") return send(res,409,{success:false,message:"CMADD connection is inactive. Website offer cannot be booked."});
      const order=(await supabase("website_orders",{method:"POST",body:{store_id:reward.store_id,reward_id:reward.id,amount:99,status:"requested",website_type:"static",domain_preference:String(b.domain_preference||"").trim()||null,requirements:String(b.requirements||"").trim()||null}}))[0];
      await supabase("partner_rewards?id=eq."+encodeURIComponent(reward.id),{method:"PATCH",body:{status:"ordered"}});
      await audit("WEBSITE_ORDER_CREATED","website_order",order.id,{reward_id:reward.id});
      return send(res,201,{success:true,order});
    }
    if (req.method==="PATCH") {
      const b=readBody(req), id=String(b.id||""), status=String(b.status||"");
      if (!id || !["requested","confirmed","in_progress","delivered"].includes(status)) return send(res,400,{success:false,message:"Order and valid status are required."});
      const order=(await supabase("website_orders?id=eq."+encodeURIComponent(id),{method:"PATCH",body:{status,updated_at:new Date().toISOString()}}))[0];
      if (!order) return send(res,404,{success:false,message:"Order not found."});
      if (status==="delivered") await supabase("partner_rewards?id=eq."+encodeURIComponent(order.reward_id),{method:"PATCH",body:{status:"delivered"}});
      await audit("WEBSITE_ORDER_STATUS_CHANGED","website_order",id,{status});
      return send(res,200,{success:true,order});
    }
    return send(res,405,{success:false,message:"Method not allowed."});
  } catch(e) { console.error(e); return send(res,e.status||500,{success:false,message:e.message||"Website order request failed."}); }
};
