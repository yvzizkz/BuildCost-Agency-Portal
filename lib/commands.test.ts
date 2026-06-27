import { describe, it, expect, beforeEach, vi } from 'vitest';
import { approve, reject, requestGeneration, generateSlot, ingestDropboxLink, isDropboxUrl } from './commands';
import { mockSetDoc } from '../test/firebaseMock';

describe('lib/commands.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('approve', () => {
    it('should call setDoc for a valid queueId', async () => {
      await approve('agency1', 'brand1', 'user1', 'valid-queue-id');
      expect(mockSetDoc).toHaveBeenCalled();
    });

    it('should throw error for invalid queueId', async () => {
      await expect(approve('agency1', 'brand1', 'user1', 'invalid/id'))
        .rejects.toThrow('Invalid queueId.');
      expect(mockSetDoc).not.toHaveBeenCalled();
    });
  });

  describe('reject', () => {
    it('should call setDoc for valid input', async () => {
      await reject('agency1', 'brand1', 'user1', 'valid-id', 'Some notes');
      expect(mockSetDoc).toHaveBeenCalled();
    });

    it('should throw error if notes are empty', async () => {
      await expect(reject('agency1', 'brand1', 'user1', 'valid-id', '   '))
        .rejects.toThrow('Revision notes are required to reject a queue item.');
      expect(mockSetDoc).not.toHaveBeenCalled();
    });

    it('should trim and cap notes', async () => {
      const longNotes = 'a'.repeat(600);
      await reject('agency1', 'brand1', 'user1', 'valid-id', longNotes);
      expect(mockSetDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          notes: 'a'.repeat(500)
        })
      );
    });
  });

  describe('requestGeneration', () => {
    it('should call setDoc for valid producer and options', async () => {
      await requestGeneration('agency1', 'brand1', 'user1', 'social', {
        project: 'valid-slug',
        media: 'single'
      });
      expect(mockSetDoc).toHaveBeenCalled();
    });

    it('should throw for invalid producer', async () => {
      await expect(requestGeneration('agency1', 'brand1', 'user1', 'invalid', {}))
        .rejects.toThrow('Invalid producer: invalid');
    });

    it('should throw for invalid project slug', async () => {
      await expect(requestGeneration('agency1', 'brand1', 'user1', 'social', { project: 'Invalid_Slug' }))
        .rejects.toThrow('Invalid project id.');
    });

    it('should throw for invalid media', async () => {
      await expect(requestGeneration('agency1', 'brand1', 'user1', 'social', { media: 'card' }))
        .rejects.toThrow('Invalid media: card');
    });
  });

  describe('generateSlot', () => {
    it('writes a scoped generateSlot command for valid input', async () => {
      await generateSlot('agency1', 'brand1', 'user1', 'valid-submission-id', 3);
      expect(mockSetDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: 'generateSlot',
          status: 'requested',
          requestedByUid: 'user1',
          payload: { submissionId: 'valid-submission-id', slotN: 3 },
        })
      );
    });

    it('throws for an invalid submissionId', async () => {
      await expect(generateSlot('agency1', 'brand1', 'user1', 'bad/id', 1))
        .rejects.toThrow('Invalid submissionId.');
      expect(mockSetDoc).not.toHaveBeenCalled();
    });

    it('throws for a non-integer / out-of-range slot number', async () => {
      await expect(generateSlot('agency1', 'brand1', 'user1', 'valid-id', 0))
        .rejects.toThrow('Invalid slot number.');
      await expect(generateSlot('agency1', 'brand1', 'user1', 'valid-id', 2.5))
        .rejects.toThrow('Invalid slot number.');
      await expect(generateSlot('agency1', 'brand1', 'user1', 'valid-id', 999))
        .rejects.toThrow('Invalid slot number.');
      expect(mockSetDoc).not.toHaveBeenCalled();
    });
  });

  describe('isDropboxUrl', () => {
    it('accepts https Dropbox share + CDN links', () => {
      expect(isDropboxUrl('https://www.dropbox.com/s/abc/file.mp4?dl=0')).toBe(true);
      expect(isDropboxUrl('https://dropbox.com/scl/fi/x/y.zip')).toBe(true);
      expect(isDropboxUrl('https://uc1.dl.dropboxusercontent.com/cd/0/get/file')).toBe(true);
    });
    it('rejects non-dropbox, http, and look-alike hosts', () => {
      expect(isDropboxUrl('http://www.dropbox.com/s/abc/file')).toBe(false); // not https
      expect(isDropboxUrl('https://dropbox.com.evil.com/x')).toBe(false);
      expect(isDropboxUrl('https://drive.google.com/file/d/x')).toBe(false);
      expect(isDropboxUrl('not a url')).toBe(false);
      expect(isDropboxUrl('')).toBe(false);
    });
  });

  describe('ingestDropboxLink', () => {
    it('writes a scoped ingestLink command for a valid Dropbox link', async () => {
      await ingestDropboxLink('agency1', 'brand1', 'user1', 'https://www.dropbox.com/s/abc/file.mp4?dl=0', 'My Project');
      expect(mockSetDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: 'ingestLink',
          status: 'requested',
          requestedByUid: 'user1',
          source: 'dropbox',
          title: 'My Project',
        })
      );
    });

    it('throws (and writes nothing) for a non-Dropbox link', async () => {
      await expect(ingestDropboxLink('agency1', 'brand1', 'user1', 'https://evil.com/x'))
        .rejects.toThrow(/valid Dropbox share link/);
      expect(mockSetDoc).not.toHaveBeenCalled();
    });
  });
});
