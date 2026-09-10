const userVisitLandingPageAlertTemplate = ({
  ipAddress,
  visitTime,
  devicename,
  result_ipdetails,
}) => {
  const ipData = result_ipdetails?.data || null;

  const locationSection = ipData
    ? `
        <div class="detail-row">
          <div class="label">City</div>
          <div class="value">${ipData.city || "N/A"}</div>
        </div>
        <div class="detail-row">
          <div class="label">Region</div>
          <div class="value">${ipData.region || "N/A"}</div>
        </div>
        <div class="detail-row">
          <div class="label">Country</div>
          <div class="value">${ipData.country || "N/A"}</div>
        </div>
        <div class="detail-row">
          <div class="label">Location (Lat, Lng)</div>
          <div class="value">${ipData.loc || "N/A"}</div>
        </div>
        <div class="detail-row">
          <div class="label">ISP / Organization</div>
          <div class="value">${ipData.org || "N/A"}</div>
        </div>
        <div class="detail-row">
          <div class="label">Postal Code</div>
          <div class="value">${ipData.postal || "N/A"}</div>
        </div>
        <div class="detail-row">
          <div class="label">Timezone</div>
          <div class="value">${ipData.timezone || "N/A"}</div>
        </div>
      `
    : `
        <div class="detail-row">
          <div class="label">Location Details</div>
          <div class="value" style="color:#94a3b8;">Not available (localhost or lookup failed)</div>
        </div>
      `;

  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>New Visitor Alert - ServerPe</title>
    <style>
      body { margin: 0; padding: 0; font-family: 'Segoe UI', sans-serif; background-color: #f5f7fa; }
      .container { max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
      .header { background: #1e293b; color: #ffffff; padding: 20px; text-align: center; }
      .content { padding: 30px; }
      .alert-box { background-color: #f0fdf4; border: 1px solid #10b981; padding: 15px; border-radius: 6px; margin-bottom: 20px; }
      .section-title { font-size: 14px; font-weight: 700; color: #1e293b; margin: 25px 0 10px; padding-bottom: 6px; border-bottom: 2px solid #1e293b; text-transform: uppercase; }
      .detail-row { margin: 15px 0; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; }
      .label { font-weight: bold; color: #64748b; font-size: 12px; text-transform: uppercase; }
      .value { font-size: 16px; color: #1e293b; margin-top: 4px; }
      .footer { background: #f8fafc; padding: 20px; text-align: center; font-size: 11px; color: #94a3b8; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h2 style="margin:0;">Landing Page Visit Alert</h2>
      </div>
      <div class="content">
        <div class="alert-box">
          <p style="margin:0; color: #047857; font-weight: 600;">A new user just visited the ServerPe landing page.</p>
        </div>

        <div class="section-title">From Website</div>
        <div class="detail-row">
          <div class="label">Website</div>
          <div class="value"><a href="https://serverpe.in" style="color:#1e293b; text-decoration:none;">serverpe.in</a></div>
        </div>

        <div class="section-title">Visitor Info</div>
        <div class="detail-row">
          <div class="label">IP Address</div>
          <div class="value">${ipAddress}</div>
        </div>
        <div class="detail-row">
          <div class="label">Visit Date & Time</div>
          <div class="value">${visitTime}</div>
        </div>
        <div class="detail-row">
          <div class="label">Device / OS / Browser</div>
          <div class="value">${devicename}</div>
        </div>

        <div class="section-title">Location Details</div>
        ${locationSection}
      </div>
      <div class="footer">
        &copy; 2025 ServerPe App Solutions &bull; Automated System Alert
      </div>
    </div>
  </body>
  </html>
  `;
};

module.exports = userVisitLandingPageAlertTemplate;
