import { Injectable, Logger, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

export interface HcmBalance {
  employeeId: string;
  locationId: string;
  totalDays: number;
  availableDays: number;
}

export interface HcmDeductResult {
  employeeId: string;
  locationId: string;
  remainingDays: number;
}

@Injectable()
export class HcmAdapter {
  private readonly logger = new Logger(HcmAdapter.name);
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(private readonly http: HttpService, private readonly config: ConfigService) {
    this.baseUrl = config.get<string>('HCM_BASE_URL', 'http://localhost:4000');
    this.headers = { Authorization: `Bearer ${config.get<string>('HCM_API_KEY', '')}` };
  }

  async getBalance(employeeId: string, locationId: string): Promise<HcmBalance> {
    try {
      const { data } = await firstValueFrom(
        this.http.get<HcmBalance>(
          `${this.baseUrl}/hcm/balance/${employeeId}/${locationId}`,
          { headers: this.headers },
        ),
      );
      return data;
    } catch (error) {
      return this.handleError(error, 'getBalance');
    }
  }

  async deduct(employeeId: string, locationId: string, days: number): Promise<HcmDeductResult> {
    try {
      const { data } = await firstValueFrom(
        this.http.post<HcmDeductResult>(
          `${this.baseUrl}/hcm/deduct`,
          { employeeId, locationId, days },
          { headers: this.headers },
        ),
      );
      return data;
    } catch (error) {
      return this.handleError(error, 'deduct');
    }
  }

  private handleError(error: any, operation: string): never {
    const status: number | undefined = error?.response?.status;
    const errorData = error?.response?.data;

    if (!status || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      this.logger.error(`HCM unreachable during ${operation}`);
      throw new ServiceUnavailableException('HCM is unreachable');
    }
    if (status === 503) {
      throw new ServiceUnavailableException('HCM is unavailable');
    }
    if (status === 422 || status === 404) {
      throw new UnprocessableEntityException(errorData?.error ?? 'HCM rejected the operation');
    }

    this.logger.error(`HCM error during ${operation}: ${status} ${JSON.stringify(errorData)}`);
    throw new ServiceUnavailableException('HCM error');
  }
}
