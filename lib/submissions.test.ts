import { describe, it, expect, beforeEach, vi } from 'vitest';
import { uploadAndSubmit } from './submissions';
import { mockSetDoc, mockUploadBytes } from '../test/firebaseMock';

describe('lib/submissions.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockFile = (name: string, size: number, type: string) => {
    const file = new File([''], name, { type });
    Object.defineProperty(file, 'size', { value: size });
    return file;
  };

  it('should sanitize file names and upload', async () => {
    const file = mockFile('../../malicious.jpg', 1024, 'image/jpeg');
    await uploadAndSubmit('agency1', 'brand1', 'user1', {
      title: 'Test',
      files: [file],
      heroIndex: 0,
      processIndexes: []
    });

    expect(mockUploadBytes).toHaveBeenCalled();
    const call = mockUploadBytes.mock.calls[0];
    // Path should contain sanitized name: malicious.jpg
    expect((call[0] as any).path).toMatch(/malicious.jpg$/);
    expect((call[0] as any).path).not.toContain('..');
  });

  it('should reject files over 25MB', async () => {
    const file = mockFile('large.jpg', 26 * 1024 * 1024, 'image/jpeg');
    await expect(uploadAndSubmit('agency1', 'brand1', 'user1', {
      title: 'Test',
      files: [file],
      heroIndex: 0,
      processIndexes: []
    })).rejects.toThrow(/exceeds the 25MB limit/);
  });

  it('should reject non-image/video files', async () => {
    const file = mockFile('test.pdf', 1024, 'application/pdf');
    await expect(uploadAndSubmit('agency1', 'brand1', 'user1', {
      title: 'Test',
      files: [file],
      heroIndex: 0,
      processIndexes: []
    })).rejects.toThrow(/is not an image or video/);
  });

  it('should handle heroIndex and processIndexes bounds', async () => {
    const file1 = mockFile('1.jpg', 1024, 'image/jpeg');
    const file2 = mockFile('2.jpg', 1024, 'image/jpeg');

    await uploadAndSubmit('agency1', 'brand1', 'user1', {
      title: 'Test',
      files: [file1, file2],
      heroIndex: 5, // Out of bounds, should fallback to 0
      processIndexes: [1, 10] // 10 is out of bounds
    });

    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        heroStoragePath: expect.stringContaining('1.jpg'),
        processStoragePaths: [expect.stringContaining('2.jpg')]
      })
    );
  });
});
