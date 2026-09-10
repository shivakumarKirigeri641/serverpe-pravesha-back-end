const crypto = require("crypto");

const ALGORITHM = "aes-256-cbc";
const SECRET_KEY = process.env.SECRET_KEY;

function encryptResponse(req, res, next) {
  const originalJson = res.json.bind(res);

  res.json = function (body) {
    try {
      const key = crypto.createHash("sha256").update(SECRET_KEY).digest();
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

      let encrypted = cipher.update(JSON.stringify(body), "utf8", "base64");
      encrypted += cipher.final("base64");

      return originalJson({
        encrypted: true,
        iv: iv.toString("base64"),
        data: encrypted,
      });
    } catch (err) {
      console.error("Encryption failed:", err.message);
      return originalJson(body);
    }
  };

  next();
}

module.exports = encryptResponse;
