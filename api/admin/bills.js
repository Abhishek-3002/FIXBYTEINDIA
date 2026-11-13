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
      if (!store_id || !bill_number || !/^\\d{4}-\\d{2}-\\d{2}$/.test(bill_date) || !Number.isFinite(amount) || amount<=0) return send(res,400,{success:false,message:"Store, bill number, valid date and amount greater than zero are required."});
      let related_bill_id=null;
      if (bill_type==="return") {
        const originalNumber=String(b.related_bill_number||"").trim();
        if (!originalNumber) return send(res,400,{success:false,message:"Enter the original purchase bill number for this return."});
        const original=(await supabase("bills?select=id,cycle_id,bill_type&store_id=eq."+encodeURIComponent(store_id)+"&bill_number=eq."+encodeURIComponent(originalNumber)))[0];
        if (!original || original.bill_type!=="sale" || !original.cycle_id) return send(res,400,{success:false,message:"Original purchase bill not found or not linked to a purchase cycle."});
        related_bill_id=original.id;
      }
      const created=(await supabase("bills",{method:"POST",body:{store_id,bill_number,bill_date,bill_type,related_bill_id,amount,payment_status,status:"valid",note:String(b.note||"").trim()||null,entered_by:"FIXBYTE Admin"}}))[0];
      const eligibility=await rpc("process_partner_bill",{p_bill_id:created.id});
      await audit("BILL_CREATED","bill",created.id,{store_id,bill_type,amount,payment_status,eligibility});
      return send(res,201,{success:true,bill:created,eligibility});
    }
    if (req.method === "PATCH") {
      const b=readBody(req), id=String(b.id||""), status=String(b.status||"");
      if (!id || !["valid","cancelled"].includes(status)) return send(res,400,{success:false,message:"Bill ID and valid/cancelled status are required."});
      const before=(await supabase("bills?select=id,cycle_id& id=eq."+encodeURIComponent(id).replace("%20","")))[0];
      if (!before) return send(res,404,{success:false,message:"Bill not found."});
      const updated=(await supabase("bills?id=eq."+encodeURIComponent(id),{method:"PATCH",body:{status}}))[0];
      let eligibility=null;
      if (before.cycle_id) eligibility=await rpc("recalculate_partner_cycle",{p_cycle_id:before.cycle_id});
      await audit("BILL_STATUS_CHANGED","bill",id,{status,eligibility});
      return send(res,200,{success:true,bill:updated,eligibility});
    }
    return send(res,405,{success:false,message:"Method not allowed."});
  } catch(e) { console.error(e); return send(res,e.status||400,{success:false,message:e.message||"Bill request failed. Check bill number, original bill and date order."}); }
};
