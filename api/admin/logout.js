const { send, clearAdminCookie } = require("../_lib/common");
module.exports = function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { success:false, message:"Method not allowed." });
  clearAdminCookie(res);
  return send(res, 200, { success:true });
};
