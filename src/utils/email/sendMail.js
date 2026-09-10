const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: Number(process.env.MAIL_PORT),
  secure: process.env.MAIL_SECURE === "true",
  auth: {
    user: process.env.NOREPLYMAIL,
    pass: process.env.NOREPLYMAIL_PASSWORD,
  },
});

async function sendMail({ to, subject, html, text }) {
  return transporter.sendMail({
    from: `"${process.env.MAIL_FROM_NAME}" <${process.env.NOREPLYMAIL}>`,
    to,
    subject,
    text,
    html,
  });
}

module.exports = { sendMail };
