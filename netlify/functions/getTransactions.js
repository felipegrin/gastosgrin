// netlify/functions/getTransactions.js
const { ACTUAL_PASSWORD } = process.env;
const { q, runQuery, init, downloadBudget, getBudgetMonth } = require('@actual-app/api');

// --- Caching/Initialization outside the handler to leverage warm starts ---
let initialized = false;

async function setupActual() {
    if (initialized) {
        return; // Already initialized in a previous warm run
    }
    
    // 1. Initialize API (Local cache storage)
    await init({
      serverURL: "https://actualgrin.pikapod.net",
      password: ACTUAL_PASSWORD,
      dataDir: '/tmp', // temporary storage for serverless functions
    });

    // 2. Download the budget file (Heavy I/O operation)
    // This is the largest bottleneck and is now run once per container.
    await downloadBudget("1bc93ff2-c30a-4f25-9c36-8572ba72df56");

    initialized = true;
}
// -----------------------------------------------------------------


// ---------- Helpers ----------
function normalizeSpent(spent) {
  return Math.abs(spent);
}


async function getTransactionsList(month, cat) {
  const year = "2025";

  const { data } = await runQuery(
    q("transactions")
      .filter({
        "category.name": cat,
        $and: [
          { date: { $gte: `${year}-${month}-01` } },
          { date: { $lte: `${year}-${month}-32` } },
        ],
      })
      .groupBy("payee.name")
      .select([
        "date",
        "payee.name",
        "notes",
        { amount: { $sum: "$amount" } },
      ])
  );

  return { data };
}

// ---------- Netlify Function Handler ----------
exports.handler = async (event, context) => {
  try {
    // This function will only perform the expensive init/download once per container
    await setupActual(); 

    // Optional query param: ?lastMonth=true
    const month = event.queryStringParameters.month;
    const cat = decodeURIComponent(event.queryStringParameters.cat);
    const result = await getTransactionsList(month,cat);

    return {
      statusCode: 200,
      body: JSON.stringify(result),
    };
  } catch (err) {
    console.error("❌ Error in Netlify function:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};