/**
 * This "graph" simply exposes an endpoint for a user to upload docs to be indexed.
 */

import { RunnableConfig } from '@langchain/core/runnables';
import { StateGraph, END, START } from '@langchain/langgraph';
import fs from 'fs/promises';

import { IndexStateAnnotation } from './state.js';
import { makeRetriever } from '../shared/retrieval.js';
import {
  ensureIndexConfiguration,
  IndexConfigurationAnnotation,
} from './configuration.js';
import { reduceDocs } from '../shared/state.js';

// 添加日志工具函数
function logIngestion(level: string, message: string, data?: any): void {
  const timestamp = new Date().toISOString();
  const logPrefix = `[INGESTION][${timestamp}][${level}]`;
  
  if (data) {
    console.log(`${logPrefix} ${message}`, JSON.stringify(data, null, 2));
  } else {
    console.log(`${logPrefix} ${message}`);
  }
}

async function ingestDocs(
  state: typeof IndexStateAnnotation.State,
  config?: RunnableConfig,
): Promise<typeof IndexStateAnnotation.Update> {
  logIngestion('INFO', 'Starting document ingestion', { 
    docsCount: state.docs?.length || 0
  });

  if (!config) {
    logIngestion('ERROR', 'Configuration required to run index_docs');
    throw new Error('Configuration required to run index_docs.');
  }

  const configuration = ensureIndexConfiguration(config);
  let docs = state.docs;

  if (!docs || docs.length === 0) {
    if (configuration.useSampleDocs) {
      logIngestion('INFO', `Loading sample documents from ${configuration.docsFile}`);
      const fileContent = await fs.readFile(configuration.docsFile, 'utf-8');
      const serializedDocs = JSON.parse(fileContent);
      docs = reduceDocs([], serializedDocs);
      logIngestion('INFO', 'Sample documents loaded successfully', { 
        docsCount: docs.length 
      });
    } else {
      logIngestion('ERROR', 'No documents to index');
      throw new Error('No documents to index.');
    }
  } else {
    logIngestion('INFO', 'Processing existing documents', { 
      docsCount: docs.length 
    });
    docs = reduceDocs([], docs);
  }

  // 如果没有文档要处理，直接返回
  if (docs.length === 0) {
    logIngestion('INFO', 'No documents to process after filtering');
    return { docs: 'delete' };
  }

  try {
    logIngestion('INFO', 'Creating retriever');
    const retriever = await makeRetriever(config);
    
    logIngestion('INFO', 'Adding documents to retriever', { 
      docsCount: docs.length 
    });
    await retriever.addDocuments(docs);
    
    logIngestion('INFO', 'Documents successfully indexed');
    return { docs: 'delete' };
  } catch (error) {
    logIngestion('ERROR', 'Error indexing documents', { 
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

logIngestion('INFO', 'Creating ingestion graph');

// 简化图结构，移除重复检测节点
const builder = new StateGraph(
  IndexStateAnnotation,
  IndexConfigurationAnnotation,
)
  .addNode('ingestDocs', ingestDocs)
  .addEdge(START, 'ingestDocs')
  .addEdge('ingestDocs', END);

// Compile into a graph object that you can invoke and deploy.
export const graph = builder
  .compile()
  .withConfig({ runName: 'IngestionGraph' });

logIngestion('INFO', 'Ingestion graph created successfully');
