const { send, requireAdmin, supabase } = require("../_lib/common");
module.exports = async function handler(req,res) {
  if (req.method!=="GET") return send(res,405,{success:false,message:"Method not allowed."});
  if (!requireAdmin(req,res)) return;
  try {
    const rewards=await supabase("partner_rewards?select=*,medical_stores(store_name,store_code),eligibility_cycles(period_start,period_end,total_amount,qualified_on)&order=earned_at.desc");
    return send(res,200,{success:true,rewards});
  } catch(e) { console.error(e); return send(res,500,{success:false,message:e.message||"Rewards could not be loaded."}); }
};
