require('dotenv').config();
const axios = require('axios');
const axiosRetry = require('axios-retry').default;

const PB_API_TOKEN = process.env.PB_API_TOKEN;
const CF_TRIGGER_ID = process.env.CF_TRIGGER_ID;
const CF_TARGET_ID = process.env.CF_TARGET_ID;

if (!PB_API_TOKEN || !CF_TRIGGER_ID || !CF_TARGET_ID) {
  throw new Error(
    "Missing required env vars: PB_API_TOKEN, CF_TRIGGER_ID, or CF_TARGET_ID."
  );
}

// Retry failed PB calls (5xx)
axiosRetry(axios, { 
    retries: 3, 
    retryDelay: axiosRetry.exponentialDelay, 
    shouldRetry: (error) => error.response?.status >= 500 
});

// 🗺️ Emoji → label map (production values)
const EMOJI_MAP = {
  "📚": "LMS",
  "🏢": "Enterprise Enablement",
  "📜": "Certification",
  "⚙️": "Platform Administration",
  "🌐": "Community",
  "🙋": "End User",
};

function normalizeEmoji(emoji) {
  return emoji.normalize("NFC").replace(/\uFE0F/g, "");
}

// Normalize keys once
const normalizedEmojiMap = Object.fromEntries(
  Object.entries(EMOJI_MAP).map(([emoji, label]) => [normalizeEmoji(emoji), label])
);

/**
 * Main handler 💪
 */

async function assignFieldValue(entityId) {
  try {
    console.log(`🔍 Processing webhook for entity: ${entityId}`);

     /* -----------------------------------------------------------
       1️⃣  Read trigger field (persona) and get first emoji
    ----------------------------------------------------------- */
    const triggerRes = await axios.get(
      `https://api.productboard.com/hierarchy-entities/custom-fields-values/value?customField.id=${CF_TRIGGER_ID}&hierarchyEntity.id=${entityId}`,
      {
        headers: {
          Authorization: `Bearer ${PB_API_TOKEN}`,
          "X-Version": "1",
        },
      }
    );

    const triggerValues = triggerRes.data?.data?.value ?? [];

    const emojiRegex = /\p{Extended_Pictographic}/gu;

    const allTriggerLabels = Array.isArray(triggerValues)
      ? triggerValues.map((v) => v.label)
      : [];

    const allEmojis = allTriggerLabels.flatMap(
      (label) => label.match(emojiRegex) || []
    );

    console.log(
      `🧩 Trigger labels: ${JSON.stringify(
        allTriggerLabels
      )}, emojis: ${JSON.stringify(allEmojis)}`
    );

    const uniqueNormalizedEmojis = [
      ...new Set(allEmojis.map((e) => normalizeEmoji(e))),
    ];

    const desiredLabels = [
      ...new Set(
        uniqueNormalizedEmojis.map((e) => normalizedEmojiMap[e]).filter(Boolean)
      ),
    ];

    const unmappedEmojis = uniqueNormalizedEmojis.filter(
      (e) => !normalizedEmojiMap[e]
    );

    if (unmappedEmojis.length) {
      console.warn(
        `⚠️ Unmapped emojis ignored: ${JSON.stringify(unmappedEmojis)}`
      );
    }
    
     /* -----------------------------------------------------------
       2️⃣  Read current values on target field (category)
     ----------------------------------------------------------- */
    const targetRes = await axios.get(
      `https://api.productboard.com/hierarchy-entities/custom-fields-values/value?customField.id=${CF_TARGET_ID}&hierarchyEntity.id=${entityId}`,
      {
        headers: {
          Authorization: `Bearer ${PB_API_TOKEN}`,
          "X-Version": "1",
        },
      }
    );

    const currentLabels = Array.isArray(targetRes.data?.data?.value)
      ? targetRes.data.data.value.map((v) => v.label)
      : [];

    console.log(`🧾 Current target labels: ${JSON.stringify(currentLabels)}`);
    console.log(`🎯 Desired target labels: ${JSON.stringify(desiredLabels)}`);

    /* -----------------------------------------------------------
       3️⃣  Decide: nothing / replace / clear
    ----------------------------------------------------------- */
    if (arraysMatch(currentLabels, desiredLabels)) {
      console.log("✅ Target already correct – no update needed.");
      return { success: true, message: "No change" };
    }

    // Values differ – wipe & (optionally) replace
    await clearTargetValues(entityId);

    if (desiredLabels.length) {
      await setTargetValues(entityId, desiredLabels);
      console.log("🆕 Target values set.");
    } else {
      console.log("🗑️ Target cleared (no emoji match).");
    }

    return {
      success: true,
      updated: !arraysMatch(currentLabels, desiredLabels),
      cleared: currentLabels.length > 0 && desiredLabels.length === 0,
      added: desiredLabels.length > 0,
      message: desiredLabels.length > 0 ? "🥳 Target set" : "🧽 Target cleared",
    };
  } catch (err) {
    console.error("❌ assignFieldValue error:", {
      method: err.config?.method?.toUpperCase(),
      url: err.config?.url,
      status: err.response?.status,
      statusText: err.response?.statusText,
      data: err.response?.data,
      message: err.message,
    });
  
    return { success: false, error: err.message };
  }
}

/* -------------------------------------------------------------
   Helpers
------------------------------------------------------------- */
// Compare values
function arraysMatch(a, b) {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}
  
// Helper function to clear unassigned target value
async function clearTargetValues(entityId) {
  await axios.delete(
    `https://api.productboard.com/hierarchy-entities/custom-fields-values/value?customField.id=${CF_TARGET_ID}&hierarchyEntity.id=${entityId}`,
    {
      headers: {
        Authorization: `Bearer ${PB_API_TOKEN}`,
        "X-Version": "1",
        Accept: "application/json",
      },
    }
  );
}

// Helper function to assign mapped values
async function setTargetValues(entityId, labels) {
  await axios.put(
    `https://api.productboard.com/hierarchy-entities/custom-fields-values/value?customField.id=${CF_TARGET_ID}&hierarchyEntity.id=${entityId}`,
    {
      data: {
        type: "multi-dropdown",
        value: labels.map((label) => ({ label })),
      },
    },
    {
      headers: {
        Authorization: `Bearer ${PB_API_TOKEN}`,
        "Content-Type": "application/json",
        "X-Version": "1",
      },
    }
  );
}

module.exports = assignFieldValue;