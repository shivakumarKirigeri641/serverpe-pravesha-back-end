const validateForContactUs = (req) => {
  const { user_name, mobile_number, email, query_type_id, message } = req.body;

  if (!user_name || !user_name.trim()) {
    return {
      statuscode: 400,
      successstatus: false,
      message: "Name is required",
    };
  }

  if (user_name.trim().length < 2 || user_name.trim().length > 100) {
    return {
      statuscode: 400,
      successstatus: false,
      message: "Name must be between 2 and 100 characters",
    };
  }

  if (!mobile_number || !mobile_number.trim()) {
    return {
      statuscode: 400,
      successstatus: false,
      message: "Mobile number is required",
    };
  }

  if (!/^[6-9]\d{9}$/.test(mobile_number.trim())) {
    return {
      statuscode: 400,
      successstatus: false,
      message: "Enter a valid 10-digit Indian mobile number",
    };
  }

  if (email && email.trim()) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return {
        statuscode: 400,
        successstatus: false,
        message: "Enter a valid email address",
      };
    }
  }

  if (!query_type_id) {
    return {
      statuscode: 400,
      successstatus: false,
      message: "Query type is required",
    };
  }

  if (!message || !message.trim()) {
    return {
      statuscode: 400,
      successstatus: false,
      message: "Message is required",
    };
  }

  if (message.trim().length < 10 || message.trim().length > 500) {
    return {
      statuscode: 400,
      successstatus: false,
      message: "Message must be between 10 and 500 characters",
    };
  }

  return {
    statuscode: 200,
    successstatus: true,
    message: "Validation passed",
  };
};

module.exports = validateForContactUs;
