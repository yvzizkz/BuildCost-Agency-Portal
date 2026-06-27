import { describe, it, expect, beforeEach, vi } from 'vitest';
import { uploadAndSubmit } from './submissions';
import { mockSetDoc, mockUploadBytesResumable } from '../test/firebaseMock';

describe('Intake Flow Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should complete the full upload and submit flow', async () => {
    const files = [
      new File(['hero'], 'hero.jpg', { type: 'image/jpeg' }),
      new File(['process'], 'process.jpg', { type: 'image/jpeg' }),
    ];

    const result = await uploadAndSubmit('agency-1', 'brand-1', 'user-1', {
      title: 'New Project',
      neighborhood: 'Downtown',
      note: 'Please use these photos',
      files,
      heroIndex: 0,
      processIndexes: [1],
    });

    // Verify Storage uploads (resumable, with content-type metadata)
    expect(mockUploadBytesResumable).toHaveBeenCalledTimes(2);
    expect(mockUploadBytesResumable).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining('hero.jpg') }),
      files[0],
      expect.objectContaining({ contentType: 'image/jpeg' })
    );
    expect(mockUploadBytesResumable).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining('process.jpg') }),
      files[1],
      expect.objectContaining({ contentType: 'image/jpeg' })
    );

    // Verify Firestore submission record
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    const submissionData = mockSetDoc.mock.calls[0][1] as any;

    expect(submissionData).toMatchObject({
      uploaderUid: 'user-1',
      status: 'requested',
      title: 'New Project',
      neighborhood: 'Downtown',
      note: 'Please use these photos',
      storagePaths: [
        expect.stringContaining('hero.jpg'),
        expect.stringContaining('process.jpg'),
      ],
      heroStoragePath: expect.stringContaining('hero.jpg'),
      processStoragePaths: [
        expect.stringContaining('process.jpg'),
      ],
    });
    expect(submissionData.createdAtMs).toBeDefined();

    expect(result).toBe('mock-doc-id');
  });
});
