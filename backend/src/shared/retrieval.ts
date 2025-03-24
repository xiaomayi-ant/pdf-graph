import { VectorStoreRetriever } from '@langchain/core/vectorstores';
import { OpenAIEmbeddings } from '@langchain/openai';
import { SupabaseVectorStore } from '@langchain/community/vectorstores/supabase';
import { createClient } from '@supabase/supabase-js';
import { RunnableConfig } from '@langchain/core/runnables';
import {
  BaseConfigurationAnnotation,
  ensureBaseConfiguration,
} from './configuration.js';

// 添加日志工具函数
function logRetrieval(level: string, message: string, data?: any): void {
  const timestamp = new Date().toISOString();
  const logPrefix = `[RETRIEVAL][${timestamp}][${level}]`;
  
  if (data) {
    console.log(`${logPrefix} ${message}`, JSON.stringify(data, null, 2));
  } else {
    console.log(`${logPrefix} ${message}`);
  }
}

/**
 * 创建检索器
 * @param config 配置
 * @returns 检索器
 */
export async function makeRetriever(
  config: RunnableConfig,
): Promise<VectorStoreRetriever> {
  // 添加日志：开始创建检索器
  logRetrieval('INFO', 'Creating retriever', {
    retrieverProvider: config.retrieverProvider || 'supabase'
  });
  
  try {
    if (!config) {
      // 添加日志：配置缺失
      logRetrieval('ERROR', 'Configuration is required to create a retriever');
      throw new Error('Configuration is required to create a retriever.');
    }

    const configuration = ensureBaseConfiguration(config);
    
    if (configuration.retrieverProvider === 'supabase') {
      // 添加日志：使用Supabase检索器
      logRetrieval('INFO', 'Using Supabase retriever');
      return await makeSupabaseRetriever(configuration, config);
    }

    // 添加日志：不支持的检索器提供商
    logRetrieval('ERROR', 'Unsupported retriever provider', {
      provider: configuration.retrieverProvider
    });
    
    throw new Error(
      `Unsupported retriever provider: ${configuration.retrieverProvider}`,
    );
  } catch (error) {
    // 添加日志：错误
    logRetrieval('ERROR', 'Error creating retriever', { 
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * 创建Supabase检索器
 * @param configuration 配置
 * @param config 配置
 * @returns Supabase检索器
 */
async function makeSupabaseRetriever(
  configuration: typeof BaseConfigurationAnnotation.State,
  config?: RunnableConfig,
): Promise<VectorStoreRetriever> {
  // 添加日志：创建Supabase检索器
  logRetrieval('INFO', 'Creating Supabase retriever');
  
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      // 添加日志：环境变量缺失
      logRetrieval('ERROR', 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables are not defined');
      throw new Error(
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required.',
      );
    }

    // 添加日志：创建嵌入
    logRetrieval('INFO', 'Creating embeddings');
    const embeddings = new OpenAIEmbeddings({
      model: 'text-embedding-3-small',
    });

    // 添加日志：创建Supabase客户端
    logRetrieval('INFO', 'Creating Supabase client');
    const supabaseClient = createClient(
      process.env.SUPABASE_URL ?? '',
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    );
    
    // 添加日志：创建向量存储
    logRetrieval('INFO', 'Creating vector store');
    const vectorStore = new SupabaseVectorStore(embeddings, {
      client: supabaseClient,
      tableName: 'documents',
      queryName: 'match_documents',
    });

    // 1. 首先尝试从 config.configurable 获取值
    let rerankingEnabled = config?.configurable?.rerankingEnabled;
    let initialRetrievalK = config?.configurable?.initialRetrievalK;
    
    // 2. 如果不存在，尝试从环境变量获取
    if (rerankingEnabled === undefined) {
      rerankingEnabled = process.env.RERANKING_ENABLED === 'true';
    }
    
    if (initialRetrievalK === undefined) {
      initialRetrievalK = parseInt(process.env.RERANKING_INITIAL_K || '20', 10);
    }
    
    // 3. 确定最终的 k 值
    let k = configuration.k;
    if (rerankingEnabled) {
      k = initialRetrievalK;
    }
    
    // 4. 添加详细日志
    logRetrieval('INFO', 'Creating retriever with detailed parameters', {
      configK: configuration.k,
      rerankingEnabled: rerankingEnabled,
      initialRetrievalK: initialRetrievalK,
      finalK: k,
      configSource: config?.configurable?.rerankingEnabled !== undefined ? 'config' : 'env'
    });
    
    // 5. 使用确定的 k 值创建检索器
    const retriever = vectorStore.asRetriever({
      k: k,
      filter: configuration.filterKwargs,
    });

    // 添加日志：Supabase检索器创建成功
    logRetrieval('INFO', 'Supabase retriever created successfully');
    return retriever;
  } catch (error) {
    // 添加日志：错误
    logRetrieval('ERROR', 'Error creating Supabase retriever', { 
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}
