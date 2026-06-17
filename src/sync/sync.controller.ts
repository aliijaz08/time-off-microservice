import { Controller, Post, Get, Body, HttpException, HttpStatus, Res } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Response } from 'express';
import { SyncService, BatchSyncItem } from './sync.service';
import { Roles, Public } from '../auth/roles.decorator';

@Controller()
export class SyncController {
  constructor(
    private readonly syncService: SyncService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  @Roles('system')
  @Post('hcm/batch-sync')
  batchSync(@Body() body: BatchSyncItem[]) {
    if (!Array.isArray(body)) {
      throw new HttpException('Body must be an array', HttpStatus.BAD_REQUEST);
    }
    return this.syncService.batchSync(body);
  }

  @Public()
  @Get('health')
  async health(@Res() res: Response) {
    try {
      await this.dataSource.query('SELECT 1');
      return res.status(200).json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() });
    } catch {
      return res.status(503).json({ status: 'degraded', db: 'error', timestamp: new Date().toISOString() });
    }
  }
}
