const { send, readBody, requireAdmin, supabase, audit, makeId } = require("../_lib/common");
module.exports = async function handler(req, res) {
  if (!requireAdmin(req,res)) return;
  try {
    if (req.method === "GET") {
      const rows = await supabase("medical_stores?select=*&order=created_at.desc");
      return send(res,200,{success:true,stores:rows});
    }
    if (req.method === "POST") {
      const b = readBody(req);
      const store_name = String(b.store_name||"").trim();
      const owner_name = String(b.owner_name||"").trim();
      const mobile = String(b.mobile||"").replace(/\D/g,"");
      if (!store_name || !owner_name || mobile.length < 10) return send(res,400,{success:false,message:"Store name, owner name and valid mobile number are required."});
      const store = (await supabase("medical_stores", {method:"POST",body:{
        store_code:makeId("CMADD"), store_name, owner_name, mobile,
        email:String(b.email||"").trim()||null, address:String(b.address||"").trim()||null,
        gstin:String(b.gstin||"").trim().toUpperCase()||null,
        connection_status:"active"
      }}))[0];
      await audit("STORE_CREATED","medical_store",store.id,{store_code:store.store_code});
      return send(res,201,{success:true,store});
    }
    return send(res,405,{success:false,message:"Method not allowed."});
  } catch(e) { console.error(e); return send(res,e.status||500,{success:false,message:e.message||"Store request failed."}); }
};
