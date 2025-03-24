import { Document } from '@langchain/core/documents';
import { CrossEncoder } from '../../src/shared/cross_encoder.js';
import { Reranker } from '../../src/shared/reranker.js';

// 模拟文档数据
const mockDocuments = [
  new Document({ pageContent: 'Document about machine learning algorithms', metadata: { id: 1 } }),
  new Document({ pageContent: 'Information about deep neural networks', metadata: { id: 2 } }),
  new Document({ pageContent: 'Guide to natural language processing', metadata: { id: 3 } }),
  new Document({ pageContent: 'Introduction to computer vision', metadata: { id: 4 } }),
  new Document({ pageContent: 'Unrelated document about cooking recipes', metadata: { id: 5 } }),
];

// 模拟 CrossEncoder 类
jest.mock('../../src/shared/cross_encoder.js', () => {
  return {
    CrossEncoder: jest.fn().mockImplementation(() => {
      return {
        score: jest.fn().mockImplementation((query, documents) => {
          // 模拟评分逻辑 - 根据文档内容与查询的相关性返回分数
          return documents.map(doc => {
            let score = 0;
            // 简单的相关性评分模拟
            if (query.includes('machine learning') && doc.pageContent.includes('machine learning')) {
              score = 0.9;
            } else if (query.includes('neural') && doc.pageContent.includes('neural')) {
              score = 0.85;
            } else if (query.includes('language') && doc.pageContent.includes('language')) {
              score = 0.8;
            } else if (doc.pageContent.includes('machine') || doc.pageContent.includes('learning') || 
                      doc.pageContent.includes('neural') || doc.pageContent.includes('language')) {
              score = 0.6;
            } else {
              score = 0.2; // 不相关的文档
            }
            return { document: doc, score };
          });
        }),
      };
    }),
  };
});

describe('Reranker', () => {
  // 重置环境变量和模拟
  beforeEach(() => {
    process.env.RERANKING_ENABLED = 'true';
    process.env.RERANKING_FINAL_K = '3';
    jest.clearAllMocks();
  });

  test('should rerank documents based on relevance', async () => {
    const reranker = new Reranker({ enabled: true, finalK: 3 });
    const query = 'What are machine learning algorithms?';
    
    const rerankedDocs = await reranker.rerank(query, mockDocuments);
    
    // 验证返回的文档数量
    expect(rerankedDocs.length).toBe(3);
    
    // 验证第一个文档是最相关的
    expect(rerankedDocs[0].pageContent).toContain('machine learning');
    
    // 验证不相关的文档被过滤掉
    const hasUnrelatedDoc = rerankedDocs.some(doc => 
      doc.pageContent.includes('cooking recipes')
    );
    expect(hasUnrelatedDoc).toBe(false);
  });

  test('should return original documents when reranking is disabled', async () => {
    const reranker = new Reranker({ enabled: false });
    const query = 'What are machine learning algorithms?';
    
    const rerankedDocs = await reranker.rerank(query, mockDocuments);
    
    // 验证返回的是原始文档
    expect(rerankedDocs).toEqual(mockDocuments);
  });

  test('should handle empty document list', async () => {
    const reranker = new Reranker({ enabled: true });
    const query = 'What are machine learning algorithms?';
    
    const rerankedDocs = await reranker.rerank(query, []);
    
    // 验证返回空数组
    expect(rerankedDocs).toEqual([]);
  });

  test('should use cache for repeated queries', async () => {
    const reranker = new Reranker({ enabled: true, finalK: 3 });
    const query = 'What are neural networks?';
    
    // 第一次调用
    await reranker.rerank(query, mockDocuments);
    
    // 第二次调用相同查询
    await reranker.rerank(query, mockDocuments);
    
    // 验证 CrossEncoder.score 只被调用一次
    const crossEncoderInstance = new CrossEncoder();
    expect(crossEncoderInstance.score).toHaveBeenCalledTimes(1);
  });

  test('should apply score threshold when specified', async () => {
    const reranker = new Reranker({ 
      enabled: true, 
      finalK: 5, // 设置较大的 finalK
      scoreThreshold: 0.7 // 只保留分数 >= 0.7 的文档
    });
    const query = 'What are machine learning and natural language processing?';
    
    const rerankedDocs = await reranker.rerank(query, mockDocuments);
    
    // 验证只返回高分文档，即使 finalK 允许更多
    expect(rerankedDocs.length).toBeLessThan(5);
    
    // 验证所有返回的文档都与查询高度相关
    const allRelevant = rerankedDocs.every(doc => 
      doc.pageContent.includes('machine learning') || 
      doc.pageContent.includes('language')
    );
    expect(allRelevant).toBe(true);
  });
}); 
