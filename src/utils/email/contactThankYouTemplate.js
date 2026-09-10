const contactThankYouTemplate = ({ user_name, query_type, message }) => {
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Thank You for Contacting ServerPe</title>
    <style>
      body { margin: 0; padding: 0; font-family: 'Segoe UI', sans-serif; background-color: #f5f7fa; }
      .container { max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
      .header { background: #1e293b; color: #ffffff; padding: 20px; text-align: center; }
      .content { padding: 30px; }
      .thank-you-box { background-color: #f0fdf4; border: 1px solid #10b981; padding: 15px; border-radius: 6px; margin-bottom: 20px; }
      .section-title { font-size: 14px; font-weight: 700; color: #1e293b; margin: 25px 0 10px; padding-bottom: 6px; border-bottom: 2px solid #1e293b; text-transform: uppercase; }
      .detail-row { margin: 15px 0; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; }
      .label { font-weight: bold; color: #64748b; font-size: 12px; text-transform: uppercase; }
      .value { font-size: 16px; color: #1e293b; margin-top: 4px; }
      .message-box { background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; border-radius: 6px; margin-top: 10px; font-size: 15px; color: #334155; line-height: 1.6; }
      .note-box { background-color: #eff6ff; border: 1px solid #3b82f6; padding: 15px; border-radius: 6px; margin-top: 20px; font-size: 14px; color: #1d4ed8; line-height: 1.6; }
      .footer { background: #f8fafc; padding: 20px; text-align: center; font-size: 11px; color: #94a3b8; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h2 style="margin:0;">Thank You for Reaching Out!</h2>
      </div>
      <div class="content">
        <div class="thank-you-box">
          <p style="margin:0; color: #047857; font-weight: 600;">Hi ${user_name}, we've received your message and will get back to you shortly.</p>
        </div>

        <p style="color: #475569; font-size: 15px; line-height: 1.7; margin: 0 0 20px;">
          Thank you for contacting <strong style="color: #1e293b;">ServerPe App Solutions</strong>.
          Your query has been noted and I'll personally review it and respond as soon as possible.
          Please allow some time as I balance a full-time IT role alongside ServerPe.
        </p>

        <div class="section-title">Your Submission</div>

        <div class="detail-row">
          <div class="label">Name</div>
          <div class="value">${user_name}</div>
        </div>

        <div class="detail-row">
          <div class="label">Query Type</div>
          <div class="value">${query_type}</div>
        </div>

        <div class="detail-row">
          <div class="label">Your Message</div>
          <div class="message-box">${message}</div>
        </div>

        <div class="note-box">
          <strong>What happens next?</strong><br/>
          I'll review your query and reach out to you directly on the mobile number you provided.
          For urgent matters, you can also find contact options at
          <a href="https://serverpe.in/#contact" style="color: #2563eb;">serverpe.in</a>.
        </div>
      </div>
      <div class="footer">
        &copy; 2025 ServerPe App Solutions &bull; Smart Clicks, Smart Taps
      </div>
    </div>
  </body>
  </html>
  `;
};

module.exports = contactThankYouTemplate;
