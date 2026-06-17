import { ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { HcmAdapter } from './hcm.adapter';

function makeAdapter() {
  const http = { get: jest.fn(), post: jest.fn() } as unknown as jest.Mocked<HttpService>;
  const config = { get: jest.fn().mockReturnValue('http://localhost:4000') } as unknown as jest.Mocked<ConfigService>;
  const adapter = new HcmAdapter(http, config);
  return { adapter, http };
}

describe('HcmAdapter', () => {
  describe('getBalance', () => {
    it('returns balance data on success', async () => {
      const { adapter, http } = makeAdapter();
      http.get.mockReturnValue(of({ data: { employeeId: 'e1', locationId: 'l1', totalDays: 20, availableDays: 15 } } as any));
      const result = await adapter.getBalance('e1', 'l1');
      expect(result.totalDays).toBe(20);
      expect(result.availableDays).toBe(15);
    });

    it('throws ServiceUnavailableException on ECONNREFUSED', async () => {
      const { adapter, http } = makeAdapter();
      http.get.mockReturnValue(throwError(() => ({ code: 'ECONNREFUSED' })));
      await expect(adapter.getBalance('e1', 'l1')).rejects.toThrow(ServiceUnavailableException);
    });

    it('throws ServiceUnavailableException on ETIMEDOUT', async () => {
      const { adapter, http } = makeAdapter();
      http.get.mockReturnValue(throwError(() => ({ code: 'ETIMEDOUT' })));
      await expect(adapter.getBalance('e1', 'l1')).rejects.toThrow(ServiceUnavailableException);
    });

    it('throws ServiceUnavailableException on HCM 503', async () => {
      const { adapter, http } = makeAdapter();
      http.get.mockReturnValue(throwError(() => ({ response: { status: 503, data: {} } })));
      await expect(adapter.getBalance('e1', 'l1')).rejects.toThrow(ServiceUnavailableException);
    });

    it('throws UnprocessableEntityException on 404', async () => {
      const { adapter, http } = makeAdapter();
      http.get.mockReturnValue(throwError(() => ({ response: { status: 404, data: { error: 'INVALID_DIMENSION' } } })));
      await expect(adapter.getBalance('e1', 'l1')).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws UnprocessableEntityException on 422', async () => {
      const { adapter, http } = makeAdapter();
      http.get.mockReturnValue(throwError(() => ({ response: { status: 422, data: { error: 'INVALID_DIMENSION' } } })));
      await expect(adapter.getBalance('e1', 'l1')).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('deduct', () => {
    it('returns remainingDays on success', async () => {
      const { adapter, http } = makeAdapter();
      http.post.mockReturnValue(of({ data: { employeeId: 'e1', locationId: 'l1', remainingDays: 10 } } as any));
      const result = await adapter.deduct('e1', 'l1', 5);
      expect(result.remainingDays).toBe(10);
    });

    it('throws UnprocessableEntityException on INSUFFICIENT_BALANCE (422)', async () => {
      const { adapter, http } = makeAdapter();
      http.post.mockReturnValue(throwError(() => ({ response: { status: 422, data: { error: 'INSUFFICIENT_BALANCE' } } })));
      await expect(adapter.deduct('e1', 'l1', 99)).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws UnprocessableEntityException on INVALID_DIMENSION (422)', async () => {
      const { adapter, http } = makeAdapter();
      http.post.mockReturnValue(throwError(() => ({ response: { status: 422, data: { error: 'INVALID_DIMENSION' } } })));
      await expect(adapter.deduct('e1', 'l1', 1)).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws ServiceUnavailableException when HCM is unreachable', async () => {
      const { adapter, http } = makeAdapter();
      http.post.mockReturnValue(throwError(() => ({ code: 'ECONNREFUSED' })));
      await expect(adapter.deduct('e1', 'l1', 5)).rejects.toThrow(ServiceUnavailableException);
    });
  });
});
