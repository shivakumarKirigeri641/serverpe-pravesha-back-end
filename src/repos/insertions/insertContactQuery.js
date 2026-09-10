const SendmailTransport = require("nodemailer/lib/sendmail-transport");
const contactThankYouTemplate = require("../../utils/email/contactThankYouTemplate");
const { connectDB } = require("../../database/connectDB");
const contactRequestAlertTemplate = require("../../utils/email/contactRequestAlertTemplate");
const { sendMail } = require("../../utils/email/sendMail");
const sendWhatsAppMessage = require("../comms/sendWhatsAppMessage");
const pool = connectDB();
const insertContactQuery = async (req) => {
  try {
    const ipAddress =
      (req.headers["x-forwarded-for"] &&
        req.headers["x-forwarded-for"].split(",")[0]) ||
      req.socket?.remoteAddress ||
      null;
    const user_agent = req.headers["user-agent"];
    const result_query_type = await pool.query(
      `select *from contact_query_types where id=$1`,
      [req.body.query_type_id],
    );
    const query_name = result_query_type.rows[0].query_type;
    const result = await pool.query(
      `INSERT INTO contact_queries (user_name, mobile_number, email, query_type_id, message, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5,$6,$7) returning *`,
      [
        req.body.user_name.trim(),
        req.body.mobile_number.trim(),
        req.body.email ? req.body.email.trim() : null,
        req.body.query_type_id,
        req.body.message.trim(),
        ipAddress,
        user_agent,
      ],
    );
    //send mail to user

    if (req.body.email) {
      await sendMail({
        to: req.body.email,
        subject: "Thank you for contacting ServerPe",
        html: contactThankYouTemplate({
          user_name: req.body.user_name,
          query_type: result_query_type.rows[0].query_type,
          message: req.body.message,
        }),
      });
    }
    //whatsapp
    //commented for now as template & live mode not approved yet
    await sendWhatsAppMessage(req.body.mobile_number, req.body.user_name);
    //contact from user
    await sendMail({
      to: process.env.ADMINMAIL,
      subject: "User contacted alert",
      html: contactRequestAlertTemplate({
        mobile_number: req.body.mobile_number,
        user_name: req.body.user_name,
        query_type: result_query_type.rows[0].query_type,
        message: req.body.message,
      }),
      text: "Alert! User conatcted page",
    });
    return {
      statuscode: 201,
      successstatus: true,
      message:
        "Thank you! Your query has been submitted. We will get back to you soon.",
      data: result.rows[0],
    };
  } catch (err) {
    return {
      statuscode: 500,
      successstatus: false,
      message: `Error submitting contact query. Error: ${err.message}`,
    };
  }
};

module.exports = insertContactQuery;
