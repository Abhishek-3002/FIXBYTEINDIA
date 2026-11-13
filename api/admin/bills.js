const { send, readBody, requireAdmin, supabase, rpc, audit } = require("../_lib/common");
module.exports = async function handler(req,res) {
  if (!requireAdmin(req,res)) return;
  try {
    if (req.method === "GET") {
      const storeId = String(req.query?.store_id||"");
      const filter = storeId ? "&store_id=eq."+encodeURIComponent(storeId) : "";
      const bills = await supabase("bills?select=*,medical_stores(store_name,store_code)&order=bill_date.desc,created_at.desc"+filter);
      return send(res,200,{success:true,bills});
    }
    if (req.method === "POST") {
      const b = readBody(req);
      const store_id=String(b.store_id||"");
      const bill_number=String(b.bill_number||"").trim();
      const bill_date=String(b.bill_date||"");
      const amount=Number(b.amount);
      const bill_type=b.bill_type==="return"?"return":"sale";
      const payment_status=["paid","credit","partial"].includes(b.payment_status)?b.payment_status:"paid";
      if (!store_id || !bill_number || !/^\d{4}-\d{2}-\d{2}$/.test(bill_date) || !Number.isFinite(amount) || amount<=0) return send(res,400,{success:false,message:"Store, bill number, valid date and amount greater than zero are required."});
      const created=(await supabase("bills",{method:"POST",body:{store_id,bill_number,bill_date,bill_type,amount,payment_status,status:"valid",note:String(b.note||"").trim()||null,entered_by:"FIXBYTE Admin"}}))[0];
      const eligibility=await rpc("process_partner_bill",{p_bill_id:created.id});
      await audit("BILL_CREATED","bill",created.id,{store_id,bill_type,amount,payment_status,eligibility});
      return send(res,201,{success:true,bill:created,eligibility});
    }
    return send(res,405,{success:false,message:"Method not allowed."});
  } catch(e) { console.error(e); return send(res,e.status||400,{success:false,message:e.message||"Bill request failed. Check bill number and date order."}); }
};
