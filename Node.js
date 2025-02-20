const { publishMessage } = require("./src/utils/redis/publisher");

publishMessage("email_channel_XYZ789", { test: "This is a test message!" });
