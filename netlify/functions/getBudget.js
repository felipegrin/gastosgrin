// netlify/functions/budget.js
const { ACTUAL_PASSWORD } = process.env;
const { q, runQuery, init, downloadBudget, getBudgetMonth } = require('@actual-app/api');

// ---------- Helpers ----------
function normalizeSpent(spent) {
  return Math.abs(spent);
}

async function getCategories() {
  const { data } = await runQuery(q('categories').select('*'));
  return data;
}

async function enrichBudgetCategories(isLastMonth) {
  const { data: categories } = await runQuery(q('categories').select('*'));

  const today = new Date();
  let year = today.getFullYear();
  let month = today.getMonth() + 1;

  if (isLastMonth === "true") {
    month = today.getMonth();
  }

  const normalizdMonth = month.toString().padStart(2, '0');
  const budget = await getBudgetMonth(`${year}-${normalizdMonth}`);

  const groups = budget.categoryGroups;
  const totalSpent = normalizeSpent(budget.totalSpent);
  const fromLastMonth = normalizeSpent(budget.fromLastMonth);
  const lucro = fromLastMonth - totalSpent;

  // Flatten categories
  const allCategories = groups.flatMap(group => group.categories);

  // Merge goals
  for (const cat of allCategories) {
    const match = categories.find(c => c.id === cat.id);
    if (match) cat.goal = match.goal_def;
  }

  // Filter out hidden + special groups
  const visibleCategories = allCategories
    .filter(cat => !cat.hidden)
    .filter(cat => cat.group_id !== "2E1F5BDB-209B-43F9-AF2C-3CE28E380C00") // income
    .filter(cat => cat.group_id !== "acf7c9c5-f825-4d01-9edf-d4e3b62f7d22"); // poupancas

  // Calculate total goals
let totalgoals = 0;
for (const cat of visibleCategories) {
  if (!cat.goal) continue;

  let goal2;
  try {
    goal2 = JSON.parse(cat.goal);
  } catch {
    continue; // skip invalid JSON
  }

  if (!Array.isArray(goal2) || !goal2[0]) continue;

  const g = goal2[0];
  if (g.limit && g.limit.amount != null) {
    totalgoals += g.limit.amount;
  } else if (g.monthly != null) {
    totalgoals += g.monthly;
  }
}

  // Filter only poupancas
  const poupancaCategories = allCategories
    .filter(cat => !cat.hidden)
    .filter(cat => cat.group_id === "acf7c9c5-f825-4d01-9edf-d4e3b62f7d22");

  return { visibleCategories, poupancaCategories, totalSpent, fromLastMonth, lucro, month, totalgoals };
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
    const isLastMonth = event.queryStringParameters.lastMonth || "false";
    const result = await enrichBudgetCategories(isLastMonth);
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