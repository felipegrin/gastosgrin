// netlify/functions/getBudget.js
const { ACTUAL_PASSWORD } = process.env;
const { q, runQuery, init, downloadBudget, getBudgetMonth } = require('@actual-app/api');

// --- Caching/Initialization outside the handler to leverage warm starts ---
let initialized = false;

async function setupActual() {
  // We can use the below to skip loading the budget file if it's already on the cache. The problem is that this won't refresh and we might get outaded budget info
  // if (initialized) {
  //     console.log("skipping initialization");
  //     return; 
  // }

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

// Removed the unused getCategories helper function

async function enrichBudgetCategories(isLastMonth) {
  const { data: categories } = await runQuery(q('categories').select('*'));

  const today = new Date();
  let year = today.getFullYear();
  let month = today.getMonth() + 1;

  if (isLastMonth === "true") {
    month = today.getMonth();
  }

  if (month == 0) {
     month = 12;
     year = today.getFullYear()-1;
  }

  const normalizdMonth = month.toString().padStart(2, '0');
  const budget = await getBudgetMonth(`${year}-${normalizdMonth}`);

  const groups = budget.categoryGroups;
  const totalSpent = normalizeSpent(budget.totalSpent);
  const fromLastMonth = normalizeSpent(budget.fromLastMonth);
  const lucro = fromLastMonth - totalSpent;

  // Build grouped categories (not flattened)
  const groupedCategories = groups
    .filter(group =>
      group.id !== "2E1F5BDB-209B-43F9-AF2C-3CE28E380C00" && // exclude income
      group.id !== "acf7c9c5-f825-4d01-9edf-d4e3b62f7d22" && // exclude poupancas
      group.name !== "WISH LIST" && // exclude wish list
      !group.hidden
    )
    .map(group => ({
      name: group.name,
      categories: group.categories
        .filter(cat => !cat.hidden)
        .map(cat => {
          const match = categories.find(c => c.id === cat.id);
          if (match) cat.goal = match.goal_def;
          return cat;
        }),
    }));

  // poupancas separately
  const poupancaCategories = groups
    .find(g => g.id === "acf7c9c5-f825-4d01-9edf-d4e3b62f7d22")
    ?.categories.filter(cat => !cat.hidden) || [];


  // Merge goals
  for (const cat of poupancaCategories) {
    const match = categories.find(c => c.id === cat.id);
    if (match) cat.goal = match.goal_def;
  }
  console.log("poupancaCategories:" + poupancaCategories);

    // wishlist separately
  const wishlist = groups
    .find(g => g.name === "WISH LIST")
    ?.categories.filter(cat => !cat.hidden) || [];


  // Merge goals
  for (const cat of wishlist) {
    const match = categories.find(c => c.id === cat.id);
    if (match) cat.goal = match.goal_def;
  }
  console.log("wishlist:" + wishlist);

  // Calculate total goals
  let totalgoals = 0;
  for (const group of groupedCategories) {
    for (const cat of group.categories) {
      if (!cat.goal) continue;

      let goal2;
      try {
        goal2 = JSON.parse(cat.goal);
      } catch {
        continue; // skip invalid JSON
      }

      if (!Array.isArray(goal2) || !goal2[0]) continue;

      const g = goal2[0];
      if (g.monthly != null) {
        totalgoals += g.monthly;
        console.log(g.monthly);
      }
      else if (g.limit && g.limit.amount != null) {
        totalgoals += g.limit.amount;
                console.log(g.limit.amount);
      } 
    }
  }

  return { groupedCategories, poupancaCategories, wishlist, totalSpent, fromLastMonth, lucro, month, totalgoals };
}

// ---------- Netlify Function Handler ----------
exports.handler = async (event, context) => {
  try {
    // This function will only perform the expensive init/download once per container
    await setupActual();

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