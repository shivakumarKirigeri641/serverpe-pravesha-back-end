const { connectDB } = require("../../database/connectDB");
const pool = connectDB();
const getPrivacyPolicy = async () => {
  try {
    const result = await pool.query(
      `SELECT id, title, description from privacy_policy;`,
    );
    return {
      statuscode: 200,
      successstatus: true,
      message: "Privacy policy fetched successfully",
      data: result.rows,
    };
  } catch (err) {
    return {
      statuscode: 500,
      successstatus: false,
      message: `Error fetching Privacy policy. Error: ${err.message}`,
    };
  }
};

module.exports = getPrivacyPolicy;
