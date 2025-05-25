require("dotenv").config();
const express = require("express");
const app = express();
const port = process.env.PORT || 3000;
const executeScript = require("./processWebhook.js");

// Middleware to parse JSON payloads
app.use(express.json());

// --- Route: Handle GET for subscription validation (probe) --- //
app.get("/webhook", (req, res) => {
  const validationToken = req.query.validationToken;

  if (validationToken) {
    console.log("👍 Subscription probe received, returning validation token.");
    res.status(200).send(validationToken); // Respond with plain text
  } else {
    res.status(404).send("🫣 Not found"); // Return 404 if no validationToken
  }
});

// Access the webhook secret from environment variables
const webhookSecret = process.env.WEBHOOK_SECRET;

// --- Route: Handle POST for webhook events --- //
app.post("/webhook", async (req, res) => {
  console.log("📥 POST /webhook received!");
  console.log("𝌞 Request body:", JSON.stringify(req.body, null, 2));

  const authHeader = req.headers["authorization"];
  if (!authHeader || authHeader !== `Bearer ${webhookSecret}`) {
    console.log("🔒 Unauthorized request.");
    res.status(403).send("Unauthorized");
    return;
  }

  try {
    console.log("🔐 POST request authorized.");
    const { data } = req.body;
    const eventType = data.eventType;
    const linkTarget = data.links?.target;

    // Ensure the expected event type
    const validEvents = ["hierarchy-entity.custom-field-value.updated"];

    if (eventType && validEvents.includes(eventType)) {
      console.log(`🧠 Executing automation for ${eventType}`);

      if (linkTarget) {
        const url = new URL(linkTarget);
        const customTriggerFieldId = url.searchParams.get("customField.id");
        const hierarchyEntityId = url.searchParams.get("hierarchyEntity.id");

        // Check if this is the custom field you're targeting
        if (customTriggerFieldId === process.env.CF_TRIGGER_ID) {
          console.log(`🎯 Trigger match on custom field ${customTriggerFieldId}`);

          const result = await executeScript(hierarchyEntityId);
          if (result.success) {
            console.log(
              "🥳 Automation executed successfully:\n",
              JSON.stringify(result, null, 2)
            );
            return res.status(200).send("💪 Webhook processed successfully");
          } else {
            console.error("😢 Error executing automation:", result.error);
            return res.status(500).send("😖 Automation failed");
          }
        } else {
          console.log(`🚫 Ignoring custom field ${customTriggerFieldId}`);
          return res.status(200).send("Ignored: customTriggerFieldId did not match");
        }
      } else {
        console.warn("⚠️ Missing 'linkTarget' in payload.");
        return res.status(400).send("Missing link target");
      }
    } else {
      console.log("⚠️ Invalid event type or missing data:", eventType);
      return res.status(400).send("🫥 Ignored event type");
    }
  } catch (error) {
    console.error("❌ Error processing webhook:", error.message);
    return res.status(500).send("Internal Server Error");
  }
});

// --- Start server --- //
app.listen(port, () => {
  console.log(`🏃 Webhook server running at http://localhost:${port}`);
});
