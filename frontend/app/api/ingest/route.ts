// app/api/ingest/route.ts
import { indexConfig } from '@/constants/graphConfigs';
import { langGraphServerClient } from '@/lib/langgraph-server';
import { processPDF } from '@/lib/pdf';
import { isFileDuplicate, addUploadRecord } from '@/lib/file-utils';
import { Document } from '@langchain/core/documents';
import { NextRequest, NextResponse } from 'next/server';

// Configuration constants
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_FILE_TYPES = ['application/pdf'];

export async function POST(request: NextRequest) {
  try {
    if (!process.env.LANGGRAPH_INGESTION_ASSISTANT_ID) {
      return NextResponse.json(
        {
          error:
            'LANGGRAPH_INGESTION_ASSISTANT_ID is not set in your environment variables',
        },
        { status: 500 },
      );
    }

    const formData = await request.formData();
    const files: File[] = [];

    for (const [key, value] of formData.entries()) {
      if (key === 'files' && value instanceof File) {
        files.push(value);
      }
    }

    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    // Validate file count
    if (files.length > 5) {
      return NextResponse.json(
        { error: 'Too many files. Maximum 5 files allowed.' },
        { status: 400 },
      );
    }

    // Validate file types and sizes
    const invalidFiles = files.filter((file) => {
      return (
        !ALLOWED_FILE_TYPES.includes(file.type) || file.size > MAX_FILE_SIZE
      );
    });

    if (invalidFiles.length > 0) {
      return NextResponse.json(
        {
          error:
            'Only PDF files are allowed and file size must be less than 10MB',
        },
        { status: 400 },
      );
    }

    // Process all PDFs into Documents
    const allDocs: Document[] = [];
    const duplicateFiles: string[] = [];
    let isAtCapacity = false;
    
    for (const file of files) {
      try {
        // 使用新的file-utils检查文件是否重复
        const isDuplicate = isFileDuplicate(file.name, file.size);
        
        // 记录上传并检查是否达到容量
        const atCapacity = addUploadRecord(file.name, file.size, isDuplicate ? 'duplicate' : 'success');
        if (atCapacity) {
          isAtCapacity = true;
        }
        
        if (isDuplicate) {
          duplicateFiles.push(file.name);
          continue; // 跳过重复文件的处理
        }
        
        const docs = await processPDF(file);
        allDocs.push(...docs);
      } catch (error: any) {
        console.error(`Error processing file ${file.name}:`, error);
      }
    }

    if (!allDocs.length && duplicateFiles.length === 0) {
      return NextResponse.json(
        { error: 'No valid documents extracted from uploaded files' },
        { status: 500 },
      );
    }

    // 只有当有非重复文件时才运行摄取图
    let threadId = '';
    let ingestionRun: any = { state: {} };
    
    if (allDocs.length > 0) {
      // 运行摄取图
      const thread = await langGraphServerClient.createThread();
      threadId = thread.thread_id;
      
      ingestionRun = await langGraphServerClient.client.runs.wait(
        threadId,
        'ingestion_graph',
        {
          input: {
            docs: allDocs,
          },
          config: {
            configurable: {
              ...indexConfig,
            },
          },
        },
      );
    }

    // 构建响应信息
    const needAlert = duplicateFiles.length > 0 || isAtCapacity;
    let alertMessage = '';
    
    if (duplicateFiles.length > 0) {
      alertMessage += `Duplicate files detected and skipped: ${duplicateFiles.join(', ')}. `;
    }
    
    if (isAtCapacity) {
      alertMessage += 'Upload history capacity reached (1000 records). Oldest records will be removed.';
    }
    
    // 返回响应，包括警告信息
    return NextResponse.json({
      message: allDocs.length > 0 ? 'Documents ingested successfully' : 'No new documents to ingest',
      threadId: threadId,
      needAlert,
      alertMessage: needAlert ? alertMessage.trim() : undefined
    });
  } catch (error: any) {
    console.error('Error processing files:', error);
    return NextResponse.json(
      { error: 'Failed to process files', details: error.message },
      { status: 500 },
    );
  }
}
