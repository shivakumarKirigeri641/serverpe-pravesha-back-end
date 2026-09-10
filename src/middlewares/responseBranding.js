function responseBranding(req, res, next) {
  const originalJson = res.json.bind(res);

  res.json = function (body) {
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return originalJson({
        ...body,
        powered_by: "ServerPe App Solutions",
        website: "www.serverpe.in",
      });
    }

    return originalJson({
      powered_by: "ServerPe App Solutions",
      website: "www.serverpe.in",
      data: body,
    });
  };

  next();
}

module.exports = responseBranding;
