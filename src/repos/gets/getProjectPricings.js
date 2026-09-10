const { connectDB } = require("../../database/connectDB");
const pool = connectDB();
const getProjectPricings = async () => {
  try {
    const result = await pool.query(`SELECT jsonb_build_object(
    'categories', (
        SELECT jsonb_agg(
            jsonb_build_object(
                'id', c.id,
                'name', c.name,
                'description', c.description,
                'project_types', (
                    SELECT jsonb_agg(
                        jsonb_build_object(
                            'id', pt.id,
                            'name', pt.name,
                            'description', pt.description,
                            'plans', (
                                SELECT jsonb_agg(
                                    jsonb_build_object(
                                        'plan_id', pp.id,
                                        'plan_name', pp.name,
                                        'price', pm.price,
                                        'features', pm.features
                                    )
                                    ORDER BY pp.id
                                )
                                FROM pricing_matrix pm
                                JOIN pricing_plans pp 
                                    ON pm.plan_id = pp.id
                                WHERE pm.project_type_id = pt.id
                                  AND pm.is_active = TRUE
                                  AND pp.is_active = TRUE
                            )
                        )
                        ORDER BY pt.id
                    )
                    FROM project_types pt
                    WHERE pt.category_id = c.id
                      AND pt.is_active = TRUE
                )
            )
            ORDER BY c.id
        )
        FROM categories c
        WHERE c.is_active = TRUE
    ),
    
    'addons', (
        SELECT jsonb_agg(
            jsonb_build_object(
                'id', a.id,
                'name', a.name,
                'description', a.description,
                'price_min', a.price_min,
                'price_max', a.price_max
            )
        )
        FROM addons a
        WHERE a.is_active = TRUE
    )
) AS result;`);
    return {
      statuscode: 200,
      successstatus: true,
      message: "Project pricing list fetched successfully",
      data: result.rows[0].result,
    };
  } catch (err) {
    return {
      statuscode: 500,
      successstatus: false,
      message: `Error fetching Project pricing list. Error: ${err.message}`,
    };
  }
};
module.exports = getProjectPricings;
