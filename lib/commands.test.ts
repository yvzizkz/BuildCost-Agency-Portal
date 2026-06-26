import { describe, it, expect, beforeEach, vi } from 'vitest';
import { approve, reject, requestGeneration } from './commands';
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
});
