import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('media_objects')
@Index(['tenantId'])
export class MediaObjectOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'object_key', type: 'varchar', length: 512 })
  objectKey!: string;

  @Column({ name: 'content_type', type: 'varchar', length: 255 })
  contentType!: string;

  @Column({ name: 'size_bytes', type: 'bigint' })
  sizeBytes!: string;

  @Column({ type: 'varchar', length: 20 })
  status!: string;

  @Column({ name: 'thumbnail_key', type: 'varchar', length: 512, nullable: true })
  thumbnailKey!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
