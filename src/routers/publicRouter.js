const express = require("express");
const publicRouter = express.Router();
const getQueryTypes = require("../repos/gets/getQueryTypes");
const { sendMail } = require("../utils/email/sendMail");
const userVisitLandingPageAlertTemplate = require("../utils/email/userVisitLandingPageAlertTemplate");
const getPrivacyPolicy = require("../repos/gets/getPrivacyPolicy");
const {
  authLimiter,
  sensitiveOpLimiter,
} = require("../middlewares/rateLimiter");
const validateForContactUs = require("../validators/validateForContactUs");
const insertContactQuery = require("../repos/insertions/insertContactQuery");
const getTermsAndConditions = require("../repos/gets/getTermsAndConditions");
const getRequestDetails = require("../utils/getRequestDetails");
const getProjectPricings = require("../repos/gets/getProjectPricings");
// ======================================================
//                QUERY-TYPES
// ======================================================
publicRouter.get("/serverpe/platform/public/query-types", async (req, res) => {
  try {
    const result = await getQueryTypes();
    // Landing-page visit email DISABLED — it fired on every page load and spammed
    // the admin inbox. (getRequestDetails + sendMail intentionally removed.)
    return res.status(result.statuscode).json({
      statuscode: result.statuscode,
      powered_by: "ServerPe App Solutions",
      successstatus: result.successstatus,
      message: result.message,
      data: result.data,
    });
  } catch (err) {
    return res.status(500).json({
      statuscode: 500,
      powered_by: "ServerPe App Solutions",
      successstatus: false,
      message: `Internal server error. Error:${err.message}`,
    });
  } finally {
  }
});
// ======================================================
//                CONTACT-US
// ======================================================
publicRouter.post(
  "/serverpe/platform/public/contact-us",
  sensitiveOpLimiter,
  async (req, res) => {
    try {
      let result = validateForContactUs(req);
      if (false === result.successstatus) {
        return res.status(result.statuscode).json({
          statuscode: result.statuscode,
          powered_by: "ServerPe App Solutions",
          successstatus: result.successstatus,
          message: result.message,
        });
      }
      result = await insertContactQuery(req);
      return res.status(result.statuscode).json({
        statuscode: result.statuscode,
        powered_by: "ServerPe App Solutions",
        successstatus: result.successstatus,
        message: result.message,
        data: result?.data,
      });
    } catch (err) {
      return res.status(500).json({
        statuscode: 500,
        powered_by: "ServerPe App Solutions",
        successstatus: false,
        message: `Internal server error. Error:${err.message}`,
      });
    } finally {
    }
  },
);
// ======================================================
//                PRIVACY-POLICY
// ======================================================
publicRouter.get(
  "/serverpe/platform/public/privacy-policy",
  async (req, res) => {
    try {
      const result = await getPrivacyPolicy();
      return res.status(result.statuscode).json({
        statuscode: result.statuscode,
        powered_by: "ServerPe App Solutions",
        successstatus: result.successstatus,
        message: result.message,
        data: result?.data,
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({
        error: "Internal Server Error",
        successstatus: false,
        message: err.message,
      });
    }
  },
);
// ======================================================
//                TERMS-AND-CONDITIONS
// ======================================================
publicRouter.get(
  "/serverpe/platform/public/terms-and-conditions",
  async (req, res) => {
    try {
      const result = await getTermsAndConditions();
      return res.status(result.statuscode).json({
        statuscode: result.statuscode,
        powered_by: "ServerPe App Solutions",
        successstatus: result.successstatus,
        message: result.message,
        data: result?.data,
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({
        error: "Internal Server Error",
        successstatus: false,
        message: err.message,
      });
    }
  },
);
// ======================================================
//                PROJECT PRICING
// ======================================================
publicRouter.get(
  "/serverpe/platform/public/project-pricings",
  async (req, res) => {
    try {
      const result = await getProjectPricings();
      return res.status(result.statuscode).json({
        statuscode: result.statuscode,
        powered_by: "ServerPe App Solutions",
        successstatus: result.successstatus,
        message: result.message,
        data: result?.data,
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({
        error: "Internal Server Error",
        successstatus: false,
        message: err.message,
      });
    }
  },
);
module.exports = publicRouter;
