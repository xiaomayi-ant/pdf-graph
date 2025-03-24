// frontend/lib/file-utils.ts
import fs from 'fs';
import path from 'path';

// 定义上传记录的类型
interface UploadRecord {
  filename: string;
  fileSize: number;
  uploadTime: string;
  status: 'success' | 'duplicate';
}

// 历史记录文件路径
const HISTORY_DIR = path.join(process.cwd(), 'uploads', 'history');
const HISTORY_FILE = path.join(HISTORY_DIR, 'upload-history.json');
const MAX_RECORDS = 1000;

// 确保目录存在
function ensureDirectoryExists(dirPath: string): void {
  try {
    console.log(`Checking if directory exists: ${dirPath}`);
    if (!fs.existsSync(dirPath)) {
      console.log(`Creating directory: ${dirPath}`);
      fs.mkdirSync(dirPath, { recursive: true });
      console.log(`Directory created successfully: ${dirPath}`);
    } else {
      console.log(`Directory already exists: ${dirPath}`);
    }
  } catch (error) {
    console.error(`Error creating directory ${dirPath}:`, error);
  }
}

// 读取上传历史记录
function getUploadHistory(): UploadRecord[] {
  console.log(`Attempting to read upload history from: ${HISTORY_FILE}`);
  ensureDirectoryExists(HISTORY_DIR);
  
  if (!fs.existsSync(HISTORY_FILE)) {
    console.log(`History file does not exist, returning empty array`);
    return [];
  }
  
  try {
    const data = fs.readFileSync(HISTORY_FILE, 'utf8');
    console.log(`Successfully read history file, contains ${data.length} bytes`);
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading upload history:', error);
    return [];
  }
}

// 保存上传历史记录
function saveUploadHistory(records: UploadRecord[]): void {
  console.log(`Attempting to save ${records.length} records to: ${HISTORY_FILE}`);
  ensureDirectoryExists(HISTORY_DIR);
  
  try {
    const data = JSON.stringify(records, null, 2);
    fs.writeFileSync(HISTORY_FILE, data);
    console.log(`Successfully saved history file, wrote ${data.length} bytes`);
  } catch (error) {
    console.error('Error saving upload history:', error);
  }
}

// 添加上传记录，实现FIFO机制
export function addUploadRecord(
  filename: string, 
  fileSize: number, 
  status: 'success' | 'duplicate'
): boolean {
  console.log(`Adding upload record: ${filename}, size: ${fileSize}, status: ${status}`);
  const records = getUploadHistory();
  
  // 检查是否达到记录上限
  const isAtCapacity = records.length >= MAX_RECORDS;
  
  // 如果达到上限，删除最早的记录(FIFO)
  if (isAtCapacity) {
    console.log(`Record limit reached (${MAX_RECORDS}), removing oldest record`);
    records.shift();
  }
  
  // 添加新记录
  records.push({
    filename,
    fileSize,
    uploadTime: new Date().toISOString(),
    status
  });
  
  // 保存更新后的记录
  saveUploadHistory(records);
  
  return isAtCapacity;
}

// 检查文件是否重复
export function isFileDuplicate(filename: string, fileSize: number): boolean {
  console.log(`Checking if file is duplicate: ${filename}, size: ${fileSize}`);
  const records = getUploadHistory();
  
  // 查找是否存在相同文件名和大小的记录
  const isDuplicate = records.some(record => 
    record.filename === filename && 
    record.fileSize === fileSize &&
    record.status === 'success'
  );
  
  console.log(`Duplicate check result for ${filename}: ${isDuplicate}`);
  return isDuplicate;
}

// 获取历史记录数量
export function getUploadHistoryCount(): number {
  return getUploadHistory().length;
}

// 获取重复文件数量
export function getDuplicateFilesCount(): number {
  const records = getUploadHistory();
  return records.filter(record => record.status === 'duplicate').length;
}
