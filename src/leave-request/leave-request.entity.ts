import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum LeaveStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

@Entity('leave_requests')
export class LeaveRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  employeeId: string;

  @Column()
  locationId: string;

  @Column()
  startDate: string;

  @Column()
  endDate: string;

  @Column({ type: 'float' })
  daysRequested: number;

  @Column({ type: 'varchar', default: LeaveStatus.PENDING })
  status: LeaveStatus;

  @CreateDateColumn()
  requestedAt: Date;

  @Column({ nullable: true, type: 'datetime' })
  resolvedAt: Date | null;

  @Column({ nullable: true, type: 'varchar' })
  resolvedBy: string | null;

  @Column({ nullable: true, type: 'varchar' })
  note: string | null;
}
