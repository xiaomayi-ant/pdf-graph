import fetch from 'node-fetch';
import { Document } from '@langchain/core/documents';

export interface CrossEncoderOptions {
  apiUrl?: string;
}

export interface ScoredDocument {
  document: Document;
  score: number;
}

/**
 * CrossEncoder class for document reranking
 * Uses local API to score query-document pairs
 */
export class CrossEncoder {
  private apiUrl: string;
  
  /**
   * Create a new CrossEncoder instance
   * @param options Configuration options
   */
  constructor(options?: CrossEncoderOptions) {
    this.apiUrl = options?.apiUrl || process.env.RERANK_API_URL || 'http://localhost:7000/rerank';
  }
  
  /**
   * Score a list of documents against a query
   * @param query The query to score against
   * @param documents The documents to score
   * @returns Scored documents
   */
  async score(query: string, documents: Document[]): Promise<ScoredDocument[]> {
    const texts = documents.map(doc => doc.pageContent);
    const scores = await this.scoreTexts(query, texts);
    
    return documents.map((doc, i) => ({
      document: doc,
      score: scores[i]
    }));
  }
  
  /**
   * Score an array of texts against a query
   * @param query The query to score against
   * @param texts Array of text strings to score
   * @returns Array of scores
   */
  async scoreTexts(query: string, texts: string[]): Promise<number[]> {
    try {
      // 调用本地 API
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, documents: texts })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const results = await response.json();
      console.log("API Response:", JSON.stringify(results.slice(0, 3), null, 2));
      
      // 按原始顺序返回分数
      const scoreMap = new Map();
      results.forEach(item => {
        scoreMap.set(item.document, item.score);
      });
      
      const scores = texts.map(text => scoreMap.get(text) || 0);
      console.log("Extracted scores (first 3):", scores.slice(0, 3));
      
      return texts.map(text => scoreMap.get(text) || 0);
    } catch (error) {
      console.error(`Error calling rerank API: ${error}`);
      return texts.map(() => 0);
    }
  }
} 
