import { Annotation } from '@langchain/langgraph';
import { Document } from '@langchain/core/documents';
import { reduceDocs } from '../shared/state.js';

/**
 * Represents the state for document indexing and retrieval.
 *
 * This interface defines the structure of the index state, which includes
 * the documents to be indexed and the retriever used for searching
 * these documents.
 */
export const IndexStateAnnotation = Annotation.Root({
  /**
   * A list of documents that the agent can index.
   */
  docs: Annotation<
    Document[],
    Document[] | { [key: string]: any }[] | string[] | string | 'delete'
  >({
    default: () => [],
    reducer: reduceDocs,
  }),
});

export type IndexStateType = typeof IndexStateAnnotation.State;

// 简化状态定义，移除重复文件相关字段
export interface IngestionState {
  docs: Document[];
  chunks: Document[];
  vectorized: boolean;
}

// 保留处理文档函数
export async function processDocuments(state: IngestionState): Promise<IngestionState> {
  // 这里可以添加文档处理逻辑，如分块等
  return {
    ...state,
    chunks: state.docs,
    vectorized: false
  };
}
