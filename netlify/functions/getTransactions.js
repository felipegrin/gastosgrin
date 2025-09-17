// netlify/functions/budget.js
const { ACTUAL_PASSWORD } = process.env;
const { q, runQuery, init, downloadBudget, getBudgetMonth } = require('@actual-app/api');

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
    // Initialize API each invocation
    await init({
      serverURL: "https://actualgrin.pikapod.net",
      password: ACTUAL_PASSWORD,
      dataDir: '/tmp', // temporary storage for serverless functions
    });
    await downloadBudget("1bc93ff2-c30a-4f25-9c36-8572ba72df56");

    // Optional query param: ?lastMonth=true
    const month = event.queryStringParameters.month || "09";
    const cat = event.queryStringParameters.cat || "Projetor";
    const result = await getTransactionsList(month,cat);
     console.log(result);

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