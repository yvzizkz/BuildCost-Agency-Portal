import { describe, it, expect, vi } from 'vitest';
import { subscribeToQueue } from './queue';
import { mockOnSnapshot, mockCollection, mockQuery } from '../test/firebaseMock';

describe('lib/queue.ts', () => {
  it('should set up a subscription with correct query', () => {
    const onUpdate = vi.fn();
    const onError = vi.fn();

    subscribeToQueue('agency1', 'brand1', onUpdate, onError);

    expect(mockCollection).toHaveBeenCalledWith(expect.anything(), 'agencies', 'agency1', 'brands', 'brand1', 'queueItems');
    expect(mockQuery).toHaveBeenCalled();
    expect(mockOnSnapshot).toHaveBeenCalled();

    // Simulate error
    const errorCallback = mockOnSnapshot.mock.calls[0][2] as any;
    errorCallback(new Error('Test error'));
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });
});
