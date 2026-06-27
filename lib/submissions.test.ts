import { describe, it, expect, beforeEach, vi } from 'vitest';
import { uploadAndSubmit } from './submissions';
import { mockSetDoc, mockUploadBytesResumable } from '../test/firebaseMock';

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

    expect(mockUploadBytesResumable).toHaveBeenCalled();
    const call = mockUploadBytesResumable.mock.calls[0];
    // Path should contain sanitized name: malicious.jpg
    expect((call[0] as any).path).toMatch(/malicious.jpg$/);
    expect((call[0] as any).path).not.toContain('..');
  });

  it('should reject files over the 2GB limit', async () => {
    const file = mockFile('huge.mp4', 3 * 1024 * 1024 * 1024, 'video/mp4');
    await expect(uploadAndSubmit('agency1', 'brand1', 'user1', {
      title: 'Test',
      files: [file],
      heroIndex: 0,
      processIndexes: []
    })).rejects.toThrow(/larger than the 2 GB limit/);
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

  it('should include the brief object if provided', async () => {
    const file = mockFile('1.jpg', 1024, 'image/jpeg');
    const brief = {
      businessType: 'construction',
      motivation: 'showcase_work',
      objective: 'leads' as const,
      channel: 'organic' as const,
      offer: 'Free quote',
      mustSay: ['Family owned'],
      mediaRights: { ownFootage: true, peopleInIt: false }
    };

    await uploadAndSubmit('agency1', 'brand1', 'user1', {
      title: 'Test',
      files: [file],
      heroIndex: 0,
      processIndexes: [],
      brief
    });

    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        brief: expect.objectContaining({
          businessType: 'construction',
          motivation: 'showcase_work',
          objective: 'leads',
          channel: 'organic',
          offer: 'Free quote',
          mustSay: ['Family owned'],
          mediaRights: { ownFootage: true, peopleInIt: false }
        })
      })
    );
  });
});
