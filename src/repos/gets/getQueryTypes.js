const { connectDB } = require("../../database/connectDB");
const pool = connectDB();
const getQueryTypes = async () => {
  try {
    const result = await pool.query(
      `SELECT id, query_type, description FROM contact_query_types WHERE is_active = true ORDER BY display_order ASC`,
    );
    return {
      statuscode: 200,
      successstatus: true,
      message: "Query types fetched successfully",
      data: result.rows,
    };
  } catch (err) {
    return {
      statuscode: 500,
      successstatus: false,
      message: `Error fetching query types. Error: ${err.message}`,
    };
  }
};

module.exports = getQueryTypes;
