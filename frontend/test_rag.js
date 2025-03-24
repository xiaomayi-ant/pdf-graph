// 加载环境变量
require('dotenv').config();

const { OpenAI } = require("openai");
const { traceable } = require("langsmith/traceable");
const { wrapOpenAI } = require("langsmith/wrappers");

// 检查环境变量
console.log("Environment variables:");
console.log("- OPENAI_API_KEY set:", !!process.env.OPENAI_API_KEY);
console.log("- LANGCHAIN_API_KEY set:", !!process.env.LANGCHAIN_API_KEY);
console.log("- LANGCHAIN_TRACING_V2:", process.env.LANGCHAIN_TRACING_V2);
console.log("- LANGCHAIN_PROJECT:", process.env.LANGCHAIN_PROJECT);

// 创建 OpenAI 客户端，确保有 API 密钥
const openAIClient = wrapOpenAI(new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
}));

async function retriever(query) {
  return ["This is a document"];
}

const rag = traceable(async function rag(question) {
  const docs = await retriever(question);

  const systemMessage =
    "Answer the users question using only the provided information below:\n\n" +
    docs.join("\n");

  return await openAIClient.chat.completions.create({
    messages: [
      { role: "system", content: systemMessage },
      { role: "user", content: question },
    ],
    model: "gpt-4o-mini",
  });
});

// 添加执行代码以测试功能
async function main() {
  try {
    console.log("Starting RAG with tracing...");
    
    const result = await rag("What is this document about?");
    console.log("Response:", result.choices[0].message.content);
    console.log("Check LangSmith for trace in project:", process.env.LANGCHAIN_PROJECT);
  } catch (error) {
    console.error("Error executing RAG:", error);
  }
}

// 执行主函数
main(); 
