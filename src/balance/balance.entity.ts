import { Entity, PrimaryGeneratedColumn, Column, Unique } from 'typeorm';

@Entity('balances')
@Unique(['employeeId', 'locationId'])
export class Balance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  employeeId: string;

  @Column()
  locationId: string;

  @Column({ type: 'float', default: 0 })
  totalDays: number;

  @Column({ type: 'float', default: 0 })
  usedDays: number;

  @Column({ type: 'float', default: 0 })
  pendingDays: number;

  @Column({ default: false })
  isOverdrawn: boolean;

  @Column({ type: 'datetime', nullable: true })
  lastSyncedAt: Date | null;
}
