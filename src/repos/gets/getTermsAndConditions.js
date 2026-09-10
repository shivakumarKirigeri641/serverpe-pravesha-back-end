const { connectDB } = require("../../database/connectDB");
const pool = connectDB();
const getTermsAndConditions = async () => {
  try {
    const result = await pool.query(
      `SELECT id, title, description from terms_conditions;`,
    );
    return {
      statuscode: 200,
      successstatus: true,
      message: "Terms and conditions fetched successfully",
      data: result.rows,
    };
  } catch (err) {
    return {
      statuscode: 500,
      successstatus: false,
      message: `Error fetching terms and conditions. Error: ${err.message}`,
    };
  }
};

module.exports = getTermsAndConditions;
