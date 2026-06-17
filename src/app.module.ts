import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, InjectDataSource } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { Employee } from './employee/employee.entity';
import { Location } from './location/location.entity';
import { Balance } from './balance/balance.entity';
import { LeaveRequest } from './leave-request/leave-request.entity';
import { AuthModule } from './auth/auth.module';
import { HcmModule } from './hcm/hcm.module';
import { BalanceModule } from './balance/balance.module';
import { LeaveRequestModule } from './leave-request/leave-request.module';
import { SyncModule } from './sync/sync.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'better-sqlite3',
        database: config.get<string>('DB_PATH', './data/timeoff.db'),
        entities: [Employee, Location, Balance, LeaveRequest],
        synchronize: true,
      }),
    }),
    AuthModule,
    HcmModule,
    BalanceModule,
    LeaveRequestModule,
    SyncModule,
  ],
})
export class AppModule implements OnModuleInit {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onModuleInit() {
    await this.dataSource.query('PRAGMA journal_mode=WAL');
  }
}
