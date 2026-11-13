const { send, readBody, requireAdmin, supabase, audit } = require("../_lib/common");
module.exports = async function handler(req,res) {
  if (req.method!=="PATCH") return send(res,405,{success:false,message:"Method not allowed."});
  if (!requireAdmin(req,res)) return;
  try {
    const b=readBody(req), id=String(b.store_id||""), status=String(b.status||"");
    if (!id || !["active","inactive"].includes(status)) return send(res,400,{success:false,message:"Store and connection status are required."});
    const store=(await supabase("medical_stores?id=eq."+encodeURIComponent(id),{method:"PATCH",body:{connection_status:status,connection_note:String(b.note||"").trim()||null,updated_at:new Date().toISOString()}}))[0];
    if (!store) return send(res,404,{success:false,message:"Store not found."});
    await audit("CONNECTION_STATUS_CHANGED","medical_store",id,{status});
    return send(res,200,{success:true,store});
  } catch(e) { console.error(e); return send(res,500,{success:false,message:e.message||"Connection update failed."}); }
};
