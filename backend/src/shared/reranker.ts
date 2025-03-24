import { Document } from '@langchain/core/documents';
import { CrossEncoder, ScoredDocument } from './cross_encoder.js';

export interface RerankerOptions {
  enabled?: boolean;
  finalK?: number;
  scoreThreshold?: number;
  apiUrl?: string;
}

/**
 * 用于日志记录的辅助函数
 */
function logReranker(level, message, data = {}) {
  console.log(`[RERANKER][${new Date().toISOString()}][${level}] ${message}`, data);
}

/**
 * Reranker class for document reranking
 * Uses CrossEncoder to score and rerank documents
 */
export class Reranker {
  private enabled: boolean;
  private finalK: number;
  private scoreThreshold?: number;
  private crossEncoder?: CrossEncoder;
  private cache: Map<string, number>;

  /**
   * Create a new Reranker instance
   * @param options Configuration options
   */
  constructor(options?: RerankerOptions) {
    this.enabled = options?.enabled ?? 
      (process.env.RERANKING_ENABLED === 'true');
    this.finalK = options?.finalK ?? 
      parseInt(process.env.RERANKING_FINAL_K || '5', 10);
    this.scoreThreshold = options?.scoreThreshold;
    this.cache = new Map();

    if (this.enabled) {
      try {
        this.crossEncoder = new CrossEncoder({
          apiUrl: options?.apiUrl ?? process.env.RERANK_API_URL
        });
      } catch (error) {
        logReranker('ERROR', 'Failed to initialize CrossEncoder', {
          error: error.message
        });
        this.enabled = false;
      }
    }
  }

  /**
   * Rerank documents based on their relevance to the query
   * @param query The query to rerank against
   * @param documents The documents to rerank
   * @returns Reranked documents
   */
  async rerank(query: string, documents: Document[]): Promise<Document[]> {
    logReranker('INFO', 'Starting reranking process', {
      query,
      documentCount: documents.length,
      enabled: this.enabled,
      finalK: this.finalK,
      threshold: this.scoreThreshold,
      apiUrl: this.crossEncoder?.apiUrl || 'unknown'
    });
    
    if (!this.enabled || !this.crossEncoder || documents.length === 0) {
      logReranker('INFO', 'Reranking skipped', {
        reason: !this.enabled ? 'disabled' : 'no CrossEncoder or empty documents'
      });
      return documents;
    }
    
    try {
      // 去重处理
      const uniqueDocMap = new Map();
      const uniqueDocs: Document[] = [];
      
      for (const doc of documents) {
        const contentHash = this.getContentHash(doc.pageContent);
        if (!uniqueDocMap.has(contentHash)) {
          uniqueDocMap.set(contentHash, doc);
          uniqueDocs.push(doc);
        }
      }
      
      if (uniqueDocs.length < documents.length) {
        logReranker('INFO', 'Removed duplicate documents', {
          before: documents.length,
          after: uniqueDocs.length,
          duplicatesRemoved: documents.length - uniqueDocs.length
        });
      }
      
      // 记录前几个文档的内容
      console.log("Document samples:", uniqueDocs.slice(0, 3).map(doc => ({
        preview: doc.pageContent.substring(0, 100),
        length: doc.pageContent.length
      })));
      
      // 直接对所有文档进行评分
      const scoredDocs = await this.scoreDocuments(query, uniqueDocs);
      
      // 按分数排序（降序）
      const sortedDocs = scoredDocs.sort((a, b) => b.score - a.score);
      
      // 检查分数多样性
      const uniqueScores = new Set(sortedDocs.map(doc => doc.score));
      if (uniqueScores.size === 1 && sortedDocs.length > 1) {
        logReranker('WARN', 'All documents received the same score', {
          score: sortedDocs[0].score,
          documentCount: sortedDocs.length
        });
      }
      
      // 记录排序后的文档顺序和分数（前5个）
      logReranker('INFO', 'Reranked documents (top 5)', {
        rerankedDocs: sortedDocs.slice(0, 5).map(doc => ({
          score: doc.score,
          preview: doc.document.pageContent.substring(0, 50),
          hash: this.getContentHash(doc.document.pageContent)
        }))
      });
      
      // Apply threshold if specified
      let filteredDocs = sortedDocs;
      if (this.scoreThreshold !== undefined) {
        filteredDocs = sortedDocs.filter(doc => doc.score >= this.scoreThreshold!);
        
        logReranker('INFO', 'Applied score threshold', {
          threshold: this.scoreThreshold,
          beforeCount: sortedDocs.length,
          afterCount: filteredDocs.length
        });
      }
      
      // Limit to top K
      const topK = Math.min(this.finalK, filteredDocs.length);
      const topDocs = filteredDocs.slice(0, topK).map(({ document, score }) => {
        // 将分数添加到元数据中
        return new Document({
          pageContent: document.pageContent,
          metadata: { ...document.metadata, score }
        });
      });
      
      logReranker('INFO', 'Reranking complete', {
        inputCount: documents.length,
        outputCount: topDocs.length,
        topScores: topDocs.slice(0, 3).map(doc => doc.metadata.score || 0)
      });
      
      return topDocs;
    } catch (error) {
      logReranker('ERROR', 'Error during reranking', {
        error: error.message
      });
      return documents;
    }
  }

  /**
   * Score a single document against a query
   * @param query The query
   * @param document The document
   * @returns Score
   */
  private async scoreDocument(query: string, document: Document): Promise<number> {
    // Check cache first
    const cacheKey = this.getCacheKey(query, document.pageContent);
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }
    
    // Score with CrossEncoder
    const scoredDocs = await this.crossEncoder!.score(query, [document]);
    const score = scoredDocs[0].score;
    
    // Update cache
    this.cache.set(cacheKey, score);
    
    return score;
  }

  /**
   * Score multiple documents against a query
   * @param query The query
   * @param documents The documents
   * @returns Scored documents
   */
  private async scoreDocuments(query: string, documents: Document[]): Promise<ScoredDocument[]> {
    // Check which documents are cached
    const uncachedDocs: Document[] = [];
    const cachedScores: ScoredDocument[] = [];
    
    for (const document of documents) {
      const cacheKey = this.getCacheKey(query, document.pageContent);
      if (this.cache.has(cacheKey)) {
        cachedScores.push({
          document,
          score: this.cache.get(cacheKey)!
        });
      } else {
        uncachedDocs.push(document);
      }
    }
    
    // Score uncached documents
    const newScores = await this.crossEncoder!.score(query, uncachedDocs);
    
    // Update cache with new scores
    for (const { document, score } of newScores) {
      const cacheKey = this.getCacheKey(query, document.pageContent);
      this.cache.set(cacheKey, score);
    }
    
    // Combine cached and new scores
    return [...cachedScores, ...newScores];
  }
  
  /**
   * Generate a cache key for a query-document pair
   * @param query The query
   * @param content The document content
   * @returns Cache key
   */
  private getCacheKey(query: string, content: string | Document[]): string {
    if (Array.isArray(content)) {
      // 处理文档数组
      return `${query}:${content.length}`;  // 使用文档数量作为缓存键的一部分
    }
    // 处理字符串
    return `${query}:${content.substring(0, 100)}`;
  }

  /**
   * 生成内容的哈希值用于去重
   * @param content 文档内容
   * @returns 哈希字符串
   */
  private getContentHash(content: string): string {
    // 简单的哈希方法，可以根据需要使用更复杂的算法
    return content.substring(0, 100);
  }
} 
