const axios = require("axios");
const getRequestDetails = async (req) => {
  let result_ipdetails = null;
  let ipAddress =
    req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress;
  let visitTime = Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  const ua = req.headers["user-agent"] || "";

  // Detect browser
  let browser = "Unknown Browser";
  if (/edg\//i.test(ua)) browser = "Microsoft Edge";
  else if (/opr\//i.test(ua) || /opera/i.test(ua)) browser = "Opera";
  else if (/chrome/i.test(ua)) browser = "Google Chrome";
  else if (/safari/i.test(ua)) browser = "Safari";
  else if (/firefox/i.test(ua)) browser = "Firefox";

  // Detect OS
  let os = "Unknown OS";
  if (/windows/i.test(ua)) os = "Windows";
  else if (/macintosh|mac os/i.test(ua)) os = "macOS";
  else if (/android/i.test(ua)) os = "Android";
  else if (/iphone/i.test(ua)) os = "iOS (iPhone)";
  else if (/ipad/i.test(ua)) os = "iOS (iPad)";
  else if (/linux/i.test(ua)) os = "Linux";

  // Detect device type
  let deviceType = "Desktop/Laptop";
  if (/mobile|iphone|android.*mobile/i.test(ua)) deviceType = "Mobile";
  else if (/tablet|ipad|android(?!.*mobile)/i.test(ua)) deviceType = "Tablet";

  let devicename = `${deviceType} | ${os} | ${browser}`;
  if (ipAddress !== "::1") {
    result_ipdetails = await axios.get(`https://ipinfo.io/${ipAddress}/json`);
  }
  return { ipAddress, visitTime, devicename, result_ipdetails };
};
module.exports = getRequestDetails;
