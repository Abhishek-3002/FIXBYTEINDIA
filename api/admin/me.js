const { send, requireAdmin } = require("../_lib/common");
module.exports = function handler(req, res) {
  if (req.method !== "GET") return send(res, 405, { success:false, message:"Method not allowed." });
  const admin = requireAdmin(req, res);
  if (!admin) return;
  return send(res, 200, { success:true, username:"FIXBYTE Admin" });
};
