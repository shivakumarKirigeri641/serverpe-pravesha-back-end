const express = require("express");
const path = require("path");
const cors = require("cors");
const cookieParser = require("cookie-parser");
require("dotenv").config();
const { connectDB } = require("./database/connectDB");
const { globalLimiter } = require("./middlewares/rateLimiter");
const publicRouter = require("./routers/publicRouter");
const encryptResponse = require("./middlewares/encryptResponse");
const responseBranding = require("./middlewares/responseBranding");
const whatsappRoutes = require("./routes/whatsapp");
const checkoutRoutes = require("./routes/checkout");
const scannerRoutes = require("./routes/scanner");
const policyRoutes = require("./routes/policy");
const flowRoutes = require("./routes/flowEndpoint");
const bookWebRoutes = require("./routes/bookWeb");
const formsWebRoutes = require("./routes/formsWeb");
const adminRoutes = require("./routes/admin");
const { PREFIX } = require("./config/paths");
const PORT = process.env.PORT;
const app = express();

/* 🔐 MUST be before CORS & cookies */
app.set("trust proxy", 1);

/* Measure latency */
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    req.latency = Date.now() - start;
  });
  next();
});

/* Keep the exact bytes of every request body.
   Meta and Razorpay both sign the raw payload; JSON.stringify(req.body) is not
   byte-identical to what was sent, so a re-serialised body fails every
   signature check. */
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; },
}));

/* ✅ CORS for cross-subdomain cookies */
/*app.use(
  cors({
    origin: ["https://serverpe.in", "https://admin.serverpe.in"],
    credentials: true,
  }),
);*/
app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  }),
);
app.use(cookieParser());

/* 🛡️ Global rate limiter – 200 requests/min per IP */
app.use(globalLimiter);

/* Inject API branding metadata into every JSON response */
app.use(responseBranding);

/* ── Gate-pass routes go BEFORE encryptResponse, deliberately.
   Meta, Razorpay, the customer's browser and the checkpost scanner are not our
   front-end and know nothing about our envelope: an encrypted body would be an
   unreadable webhook reply and a blank payment page. Everything under /api
   below keeps the encryption it has always had. */
app.use(PREFIX, whatsappRoutes);
app.use("/", checkoutRoutes);
app.use("/", scannerRoutes);
app.use("/", policyRoutes);
app.use(PREFIX, flowRoutes.router);
app.use("/", bookWebRoutes);
app.use("/", formsWebRoutes);
app.use("/admin/api", adminRoutes);

/* The fraud-demonstration pages, served under unguessable filenames so the phone
   can open one while the laptop scans it. Each holds a real ticket payload —
   delete public/demo once a demonstration is over. */
app.use("/demo", express.static(path.join(__dirname, "..", "public", "demo")));

/* 🔐 Encrypt all JSON responses */
app.use(encryptResponse);

/* Health check */
app.get("/", (req, res) => {
  res.status(200).json({
    status: "OK",
    service: "serverpeappsolutions API",
    message: "API is running successfully 🚀",
  });
});

/* Static files */

/* Routes */
app.use("/api", publicRouter);
/* DB connections */
connectDB();

/* The payment backstop. A webhook that never arrives must not cost a customer
   the ticket they paid for — this asks Razorpay directly. */
require("./jobs/reconcile").start();

app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
