import fetch from 'node-fetch';

const query = "What is the financial status of Tesla?";
const documents = [
  "This is a financial report for Tesla Inc. for the fiscal year 2023.",
  "This is a random text that has nothing to do with the query.",
  "The document contains information about directors and executive officers.",
  "Tesla's revenue grew by 20% in Q3 2023 according to the latest report.",
  "A blog post about cats and dogs living together happily.",
  "Financial analysis of Tesla's Q4 earnings shows strong growth.",
  "Elon Musk tweeted about a new Tesla factory opening in China.",
  "This is a weather forecast for California next week.",
  "Tesla's stock price hit a new high after the earnings release.",
  "A recipe for chocolate chip cookies with extra sugar.",
  "Tesla reported a profit margin increase in its latest SEC filing.",
  "The history of electric vehicles from 1990 to 2010.",
  "Tesla's balance sheet reflects $10 billion in cash reserves.",
  "A guide to hiking trails in the Rocky Mountains.",
  "Tesla's debt decreased by 15% according to financial statements.",
  "A review of the latest superhero movie released this month.",
  "Tesla's quarterly report highlights a surge in vehicle deliveries.",
  "Tips for growing tomatoes in your backyard garden.",
  "Tesla's income statement shows record profits for 2023.",
  "A random story about a lost sock in the laundry."
];

// 测试函数
async function rerankDocuments() {
  try {
    console.time('Rerank'); // 开始计时
    const response = await fetch('http://localhost:7000/rerank', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, documents })
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    
    const results = await response.json();
    results.sort((a, b) => b.score - a.score);
    
    console.log("Reranked Documents:");
    results.forEach(r => console.log(`Score: ${r.score}, Document: ${r.document}`));
    console.timeEnd('Rerank'); // 结束计时
  } catch (error) {
    console.error(`Error: ${error.message}`);
  }
}

rerankDocuments();
