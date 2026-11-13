const { send, readBody, safeEqual, sign, setAdminCookie } = require("../_lib/common");
module.exports = async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { success:false, message:"Method not allowed." });
  const username = process.env.FIXBYTE_ADMIN_USERNAME;
  const password = process.env.FIXBYTE_ADMIN_PASSWORD;
  if (!username || !password || !process.env.FIXBYTE_SESSION_SECRET || process.env.FIXBYTE_SESSION_SECRET.length < 32) {
    return send(res, 503, { success:false, message:"Admin environment variables are not configured." });
  }
  const body = readBody(req);
  if (!safeEqual(body.username, username) || !safeEqual(body.password, password)) {
    return send(res, 401, { success:false, message:"Invalid username or password." });
  }
  const token = sign({ sub:"fixbyte-admin", exp:Date.now() + 8*60*60*1000 });
  setAdminCookie(res, token);
  return send(res, 200, { success:true, message:"Welcome to FIXBYTE Verification Admin." });
};
