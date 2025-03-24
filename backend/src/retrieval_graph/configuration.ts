import { Annotation } from '@langchain/langgraph';
import { RunnableConfig } from '@langchain/core/runnables';
import {
  BaseConfigurationAnnotation,
  ensureBaseConfiguration,
} from '../shared/configuration.js';

/**
 * The configuration for the agent.
 */
export const AgentConfigurationAnnotation = Annotation.Root({
  ...BaseConfigurationAnnotation.spec,

  // models
  /**
   * The language model used for processing and refining queries.
   * Should be in the form: provider/model-name.
   */
  queryModel: Annotation<string>,

  // 重排序配置
  rerankingEnabled: Annotation<boolean>({
    default: () => process.env.RERANKING_ENABLED === 'true',
  }),
  initialRetrievalK: Annotation<number>({
    default: () => parseInt(process.env.RERANKING_INITIAL_K || '20', 10),
  }),
  finalRetrievalK: Annotation<number>({
    default: () => parseInt(process.env.RERANKING_FINAL_K || '5', 10),
  }),
  rerankerApiUrl: Annotation<string>({
    default: () => process.env.RERANK_API_URL || 'http://localhost:7000/rerank',
  }),
  promptTemplate: Annotation<string>({
    default: () => `You are an assistant for question-answering tasks. 
Use the following pieces of retrieved context to answer the question. 
If you don't know the answer, just say that you don't know. 
Use three sentences maximum and keep the answer concise.

Question: {question}

Context: {context}

Answer:`,
  }),
});

/**
 * Create a typeof ConfigurationAnnotation.State instance from a RunnableConfig object.
 *
 * @param config - The configuration object to use.
 * @returns An instance of typeof ConfigurationAnnotation.State with the specified configuration.
 */
export function ensureAgentConfiguration(
  config: RunnableConfig,
): typeof AgentConfigurationAnnotation.State {
  const configurable = (config?.configurable || {}) as Partial<
    typeof AgentConfigurationAnnotation.State
  >;
  const baseConfig = ensureBaseConfiguration(config);
  return {
    ...baseConfig,
    queryModel: configurable.queryModel || 'openai/gpt-4o',

    // 重排序配置
    rerankingEnabled: configurable.rerankingEnabled ?? 
      (process.env.RERANKING_ENABLED === 'true'),
    initialRetrievalK: configurable.initialRetrievalK ?? 
      parseInt(process.env.RERANKING_INITIAL_K || '20', 10),
    finalRetrievalK: configurable.finalRetrievalK ?? 
      parseInt(process.env.RERANKING_FINAL_K || '5', 10),
    rerankerApiUrl: configurable.rerankerApiUrl ?? (process.env.RERANK_API_URL || 'http://localhost:7000/rerank'),
    promptTemplate: configurable.promptTemplate || `You are an assistant for question-answering tasks. 
Use the following pieces of retrieved context to answer the question. 
If you don't know the answer, just say that you don't know. 
Use three sentences maximum and keep the answer concise.

Question: {question}

Context: {context}

Answer:`,
  };
}
