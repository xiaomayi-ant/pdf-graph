/**
 * This graph implements a simple RAG pipeline.
 */

import { StateGraph, START, END } from '@langchain/langgraph';
import { AgentStateAnnotation } from './state.js';
import { makeRetriever } from '../shared/retrieval.js';
import { formatDocs } from './utils.js';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { RESPONSE_SYSTEM_PROMPT, ROUTER_SYSTEM_PROMPT } from './prompts.js';
import { RunnableConfig } from '@langchain/core/runnables';
import {
  AgentConfigurationAnnotation,
  ensureAgentConfiguration,
} from './configuration.js';
import { loadChatModel } from '../shared/utils.js';
import { Reranker } from '../shared/reranker.js';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { ChatOpenAI } from '@langchain/openai';

// 添加日志工具函数
function logRetrieval(level: string, message: string, data?: any): void {
  const timestamp = new Date().toISOString();
  const logPrefix = `[RETRIEVAL_GRAPH][${timestamp}][${level}]`;
  
  if (data) {
    console.log(`${logPrefix} ${message}`, JSON.stringify(data, null, 2));
  } else {
    console.log(`${logPrefix} ${message}`);
  }
}

async function checkQueryType(
  state: typeof AgentStateAnnotation.State,
  config: RunnableConfig,
): Promise<{
  route: 'retrieve' | 'direct';
}> {
  //schema for routing
  const schema = z.object({
    route: z.enum(['retrieve', 'direct']),
    directAnswer: z.string().optional(),
  });

  const configuration = ensureAgentConfiguration(config);
  const model = await loadChatModel(configuration.queryModel);

  const routingPrompt = ROUTER_SYSTEM_PROMPT;

  const formattedPrompt = await routingPrompt.invoke({
    query: state.query,
  });

  const response = await model
    .withStructuredOutput(schema)
    .invoke(formattedPrompt.toString());

  const route = response.route;

  return { route };
}

async function answerQueryDirectly(
  state: typeof AgentStateAnnotation.State,
  config: RunnableConfig,
): Promise<typeof AgentStateAnnotation.Update> {
  const configuration = ensureAgentConfiguration(config);
  const model = await loadChatModel(configuration.queryModel);
  const userHumanMessage = new HumanMessage(state.query);

  const response = await model.invoke([userHumanMessage]);
  return { messages: [userHumanMessage, response] };
}

async function routeQuery(
  state: typeof AgentStateAnnotation.State,
): Promise<'retrieveDocuments' | 'directAnswer'> {
  const route = state.route;
  if (!route) {
    throw new Error('Route is not set');
  }

  if (route === 'retrieve') {
    return 'retrieveDocuments';
  } else if (route === 'direct') {
    return 'directAnswer';
  } else {
    throw new Error('Invalid route');
  }
}

async function retrieveDocuments(
  state: typeof AgentStateAnnotation.State,
  config: RunnableConfig,
): Promise<typeof AgentStateAnnotation.Update> {
  const configuration = ensureAgentConfiguration(config);
  
  // 添加日志：开始检索
  logRetrieval('INFO', 'Starting retrieval for query', { 
    query: state.query 
  });
  
  let k = configuration.k;
  if (configuration.rerankingEnabled) {
    k = configuration.initialRetrievalK;
  }

  const newConfig = {
    ...config,
    configurable: {
      ...config.configurable,
      initialRetrievalK: k
    }
  };

  const retriever = await makeRetriever(newConfig);
  
  try {
    // 确定检索数量
    // 如果启用了重排序，使用较大的初始检索数量
    const k = configuration.rerankingEnabled 
      ? configuration.initialRetrievalK 
      : configuration.finalRetrievalK;
    
    // 添加日志：执行检索
    logRetrieval('INFO', 'Retrieving documents', { 
      k,
      rerankingEnabled: configuration.rerankingEnabled
    });
    
    // 第一阶段：向量检索
    const documents = await retriever.getRelevantDocuments(
      state.query, 
      { k }
    );
    
    // 添加日志：检索结果
    logRetrieval('INFO', 'Retrieved documents', { 
      count: documents.length,
      firstDocSnippet: documents.length > 0 ? documents[0].pageContent.substring(0, 100) + '...' : 'No documents',
      metadata: documents.length > 0 ? documents[0].metadata : 'No metadata'
    });
    
    // 如果没有检索到文档，直接返回
    if (!documents || documents.length === 0) {
      logRetrieval('WARN', 'No documents found for query', { query: state.query });
      return { documents: [] };
    }
    
    // 第二阶段：条件性重排序
    if (configuration.rerankingEnabled) {
      try {
        logRetrieval('INFO', 'Starting reranking process', { 
          documentCount: documents.length,
          model: configuration.rerankerModel
        });
        
        const reranker = new Reranker({
          enabled: true,
          finalK: configuration.finalRetrievalK,
          model: configuration.rerankerModel
        });
        
        const rerankedDocs = await reranker.rerank(state.query, documents);
        
        logRetrieval('INFO', 'Reranking complete', { 
          originalCount: documents.length,
          rerankedCount: rerankedDocs.length,
          topDocSnippet: rerankedDocs.length > 0 ? rerankedDocs[0].pageContent.substring(0, 100) + '...' : 'No documents'
        });
        
        return { documents: rerankedDocs };
      } catch (error) {
        // 重排序失败，记录错误并回退到原始文档
        logRetrieval('ERROR', 'Reranking failed', { 
          error: error.message,
          stack: error.stack
        });
        
        // 如果重排序失败，仍然返回原始文档，但限制数量
        logRetrieval('INFO', 'Falling back to original documents with limit', {
          limit: configuration.finalRetrievalK
        });
        
        return { 
          documents: documents.slice(0, configuration.finalRetrievalK) 
        };
      }
    }
    
    // 如果未启用重排序，但检索到的文档超过了最终需要的数量，进行截断
    if (documents.length > configuration.finalRetrievalK) {
      logRetrieval('INFO', 'Truncating results to final limit', {
        originalCount: documents.length,
        limit: configuration.finalRetrievalK
      });
      
      return { 
        documents: documents.slice(0, configuration.finalRetrievalK) 
      };
    }
    
    return { documents };
  } catch (error) {
    // 检索失败，记录错误并返回空文档
    logRetrieval('ERROR', 'Retrieval failed', { 
      error: error.message,
      stack: error.stack,
      query: state.query
    });
    
    return { documents: [] };
  }
}

async function generateResponse(
  state: typeof AgentStateAnnotation.State,
  config: RunnableConfig,
): Promise<typeof AgentStateAnnotation.Update> {
  // 添加日志：开始生成回复
  logRetrieval('INFO', 'Generating response', { 
    query: state.query,
    documentCount: state.documents.length
  });
  
  const configuration = ensureAgentConfiguration(config);

  const userHumanMessage = new HumanMessage({
    content: state.query,
  });

  // 如果没有检索到文档，返回一个默认回复
  if (!state.documents || state.documents.length === 0) {
    logRetrieval('WARN', 'No documents available for response generation');
    
    const model = new ChatOpenAI({
      modelName: configuration.modelName,
      temperature: configuration.temperature,
    });
    
    const response = await model.invoke([
      userHumanMessage,
      new AIMessage({
        content:
          "I don't have any specific information about that. Could you ask me something else?",
      }),
    ]);
    
    logRetrieval('INFO', 'Generated default response for empty context', {
      responsePreview: response.content.substring(0, 100) + '...'
    });
    
    return { messages: [userHumanMessage, response] };
  }

  // 构建提示模板
  const promptTemplate = ChatPromptTemplate.fromTemplate(
    configuration.promptTemplate,
  );
  
  // 添加日志：准备上下文
  logRetrieval('INFO', 'Preparing context for response generation', {
    contextLength: state.documents.map(d => d.pageContent).join(' ').length,
    documentCount: state.documents.length
  });

  // 准备上下文
  const context = state.documents.map((d) => d.pageContent).join('\n\n');

  // 创建模型
  const model = new ChatOpenAI({
    modelName: configuration.modelName,
    temperature: configuration.temperature,
  });

  // 创建提示
  const prompt = await promptTemplate.formatMessages({
    context,
    question: state.query,
  });
  
  logRetrieval('INFO', 'Invoking language model', {
    model: configuration.modelName,
    temperature: configuration.temperature,
    promptLength: JSON.stringify(prompt).length
  });

  // 调用模型
  const response = await model.invoke(prompt);
  
  logRetrieval('INFO', 'Response generated successfully', {
    responsePreview: response.content.substring(0, 100) + '...'
  });

  return { messages: [userHumanMessage, response] };
}

const builder = new StateGraph(
  AgentStateAnnotation,
  AgentConfigurationAnnotation,
)
  .addNode('retrieveDocuments', retrieveDocuments)
  .addNode('generateResponse', generateResponse)
  .addNode('checkQueryType', checkQueryType)
  .addNode('directAnswer', answerQueryDirectly)
  .addEdge(START, 'checkQueryType')
  .addConditionalEdges('checkQueryType', routeQuery, [
    'retrieveDocuments',
    'directAnswer',
  ])
  .addEdge('retrieveDocuments', 'generateResponse')
  .addEdge('generateResponse', END)
  .addEdge('directAnswer', END);

// Compile into a graph object that you can invoke and deploy.
export const graph = builder.compile();

// 添加日志：图创建完成
logRetrieval('INFO', 'Retrieval graph created successfully');

export function createRetrievalGraph() {
  logRetrieval('INFO', 'Returning retrieval graph instance');
  return graph;
}
